import * as vscode from 'vscode';
import { inPositron } from '@posit-dev/positron';
import { getCachedParquetUri } from './cache';
import { detectClinicalDatasetFormat } from './clinicalDataset';
import { convertClinicalDatasetToParquet } from './duckdbConverter';

export function activate(context: vscode.ExtensionContext): void {
  const openedFromCustomEditor = new Set<string>();

  context.subscriptions.push(
    vscode.commands.registerCommand('cdx.openClinicalDataset', async (uri?: vscode.Uri) => {
      const sourceUri = await resolveClinicalDatasetUri(uri);
      if (!sourceUri) {
        return;
      }

      const parquetUri = await convertWithProgress(context, sourceUri, 'Opening clinical dataset');
      await vscode.commands.executeCommand('vscode.open', parquetUri);

      if (!inPositron()) {
        void vscode.window.showInformationMessage(
          'CDX converted the dataset to Parquet. Native Data Explorer display is available in Positron.'
        );
      }
    }),
    vscode.commands.registerCommand('cdx.convertClinicalDatasetToParquet', async (uri?: vscode.Uri) => {
      const sourceUri = await resolveClinicalDatasetUri(uri);
      if (!sourceUri) {
        return;
      }

      const parquetUri = await convertWithProgress(context, sourceUri, 'Converting clinical dataset');
      void vscode.window.showInformationMessage(`CDX wrote ${parquetUri.fsPath}`);
    }),
    vscode.commands.registerCommand('cdx.clearCache', async () => {
      const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'parquet');
      await vscode.workspace.fs.delete(cacheDir, { recursive: true, useTrash: false });
      void vscode.window.showInformationMessage('CDX cache cleared.');
    }),
    vscode.window.registerCustomEditorProvider(
      'cdx.clinicalDatasetPreview',
      new ClinicalDatasetPreviewProvider(context, openedFromCustomEditor),
      { supportsMultipleEditorsPerDocument: false }
    )
  );
}

export function deactivate(): void {
  // No persistent resources are held after each conversion finishes.
}

async function resolveClinicalDatasetUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri && detectClinicalDatasetFormat(uri.fsPath)) {
    return uri;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'Clinical datasets': ['sas7bdat', 'xpt']
    },
    title: 'Open Clinical Dataset'
  });

  return selected?.[0];
}

async function convertWithProgress(
  context: vscode.ExtensionContext,
  sourceUri: vscode.Uri,
  title: string
): Promise<vscode.Uri> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `CDX: ${title}`,
      cancellable: true
    },
    async (progress, token) => {
      progress.report({ message: 'Preparing cache...' });
      const parquetUri = await getCachedParquetUri(context, sourceUri);

      try {
        await vscode.workspace.fs.stat(parquetUri);
        progress.report({ message: 'Using cached Parquet file.' });
        return parquetUri;
      } catch {
        // Cache miss; convert below.
      }

      progress.report({ message: 'Reading with DuckDB read_stat...' });
      await convertClinicalDatasetToParquet(sourceUri, parquetUri, token);
      progress.report({ message: 'Parquet file ready.' });
      return parquetUri;
    }
  );
}

class ClinicalDatasetPreviewProvider implements vscode.CustomReadonlyEditorProvider<ClinicalDatasetDocument> {
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly openedFromCustomEditor: Set<string>
  ) {}

  public openCustomDocument(uri: vscode.Uri): ClinicalDatasetDocument {
    return { uri, dispose: () => undefined };
  }

  public async resolveCustomEditor(
    document: ClinicalDatasetDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.html = renderPreviewHtml();
    const documentKey = document.uri.toString();

    if (!this.openedFromCustomEditor.has(documentKey)) {
      this.openedFromCustomEditor.add(documentKey);
      try {
        const parquetUri = await convertWithProgress(this.context, document.uri, 'Opening clinical dataset');
        await vscode.commands.executeCommand('vscode.open', parquetUri);
        webviewPanel.dispose();
        return;
      } catch (error) {
        void vscode.window.showErrorMessage(formatError(error));
      }
    }

    webviewPanel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
      if (message.command !== 'open') {
        return;
      }

      const parquetUri = await convertWithProgress(this.context, document.uri, 'Opening clinical dataset');
      await vscode.commands.executeCommand('vscode.open', parquetUri);
    });
  }
}

interface ClinicalDatasetDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

function renderPreviewHtml(): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      align-items: center;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      font-family: var(--vscode-font-family);
      height: 100vh;
      justify-content: center;
      margin: 0;
    }
    main {
      display: grid;
      gap: 12px;
      justify-items: center;
      max-width: 420px;
      padding: 24px;
      text-align: center;
    }
    button {
      background: var(--vscode-button-background);
      border: 0;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font: inherit;
      padding: 8px 12px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <main>
    <h1>Clinical Data Explorer</h1>
    <p>Convert this dataset with DuckDB read_stat and open the cached Parquet result.</p>
    <button id="open">Open Dataset</button>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ command: 'open' });
    });
  </script>
</body>
</html>`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `CDX: ${error.message}`;
  }

  return 'CDX: Failed to open clinical dataset.';
}
