import { inPositron } from '@posit-dev/positron';
import * as vscode from 'vscode';
import { clearCacheDirectory } from './cache';
import { detectClinicalDatasetFormat } from './clinicalDataset';
import { ClinicalDatasetConverter } from './converter';
import { DuckDbService } from './duckdb';
import { CdxError, formatError, isCancellation } from './errors';
import { renderPreviewHtml } from './previewHtml';

const COMMAND_OPEN = 'cdx.openClinicalDataset';
const COMMAND_CONVERT = 'cdx.convertClinicalDatasetToParquet';
const COMMAND_CLEAR_CACHE = 'cdx.clearCache';

const OPEN_DIALOG_FILTERS: vscode.OpenDialogOptions['filters'] = {
  'Clinical datasets': ['sas7bdat', 'xpt']
};

/** Held at module scope so `deactivate` can shut DuckDB down. */
let duckDb: DuckDbService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const duckDbService = new DuckDbService();
  duckDb = duckDbService;

  const converter = new ClinicalDatasetConverter(context, duckDbService);
  const previewProvider = new ClinicalDatasetPreviewProvider(converter);

  context.subscriptions.push(
    previewProvider,
    registerCommand(COMMAND_OPEN, async (uri?: vscode.Uri) => {
      const sourceUri = await resolveClinicalDatasetUri(uri);
      if (!sourceUri) {
        return;
      }

      const parquetUri = await convertWithProgress(converter, sourceUri, 'Opening clinical dataset');
      await vscode.commands.executeCommand('vscode.open', parquetUri);

      if (!inPositron()) {
        void vscode.window.showInformationMessage(
          'CDX converted the dataset to Parquet. Native Data Explorer display is available in Positron.'
        );
      }
    }),
    registerCommand(COMMAND_CONVERT, async (uri?: vscode.Uri) => {
      const sourceUri = await resolveClinicalDatasetUri(uri);
      if (!sourceUri) {
        return;
      }

      const parquetUri = await convertWithProgress(
        converter,
        sourceUri,
        'Converting clinical dataset'
      );
      void vscode.window.showInformationMessage(`CDX wrote ${parquetUri.fsPath}`);
    }),
    registerCommand(COMMAND_CLEAR_CACHE, async () => {
      await clearCacheDirectory(context);
      void vscode.window.showInformationMessage('CDX cache cleared.');
    }),
    vscode.window.registerCustomEditorProvider('cdx.clinicalDatasetPreview', previewProvider, {
      supportsMultipleEditorsPerDocument: false
    })
  );
}

/**
 * Releases DuckDB's native resources.
 *
 * Returns the pending shutdown so the extension host waits for it instead of
 * tearing the process down mid-close, which can leak the database file or crash
 * on an in-flight native call.
 */
export function deactivate(): Promise<void> | undefined {
  const service = duckDb;
  duckDb = undefined;
  return service?.dispose();
}

/**
 * Registers a command, reporting failures to the user.
 *
 * Cancellations are swallowed: they are a deliberate user action, not an error.
 */
function registerCommand<Args extends unknown[]>(
  command: string,
  handler: (...args: Args) => Promise<void>
): vscode.Disposable {
  return vscode.commands.registerCommand(command, async (...args: Args) => {
    try {
      await handler(...args);
    } catch (error) {
      if (isCancellation(error)) {
        return;
      }

      void vscode.window.showErrorMessage(formatError(error));
    }
  });
}

/**
 * Resolves the dataset a command should act on.
 *
 * Commands are invoked with a URI from the Explorer context menu, and without
 * one from the command palette, in which case the user is asked to pick a file.
 */
async function resolveClinicalDatasetUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) {
    if (!detectClinicalDatasetFormat(uri.fsPath)) {
      throw new CdxError(`CDX supports only .sas7bdat and .xpt files: ${uri.fsPath}`);
    }

    return uri;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: OPEN_DIALOG_FILTERS,
    title: 'Open Clinical Dataset'
  });

  const chosen = selected?.[0];
  if (!chosen) {
    // The user dismissed the dialog.
    return undefined;
  }

  if (!detectClinicalDatasetFormat(chosen.fsPath)) {
    throw new CdxError(`CDX supports only .sas7bdat and .xpt files: ${chosen.fsPath}`);
  }

  return chosen;
}

async function convertWithProgress(
  converter: ClinicalDatasetConverter,
  sourceUri: vscode.Uri,
  title: string
): Promise<vscode.Uri> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `CDX: ${title}`,
      cancellable: true
    },
    async (progress, token) =>
      converter.convert(sourceUri, {
        token,
        onProgress: (message) => {
          progress.report({ message });
        }
      })
  );
}

interface ClinicalDatasetDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

interface PreviewMessage {
  readonly command?: string;
}

function noop(): void {
  // Intentionally empty.
}

/**
 * Custom editor shown for `.sas7bdat` and `.xpt` files.
 *
 * The first time a document is previewed, the dataset is converted and the
 * Parquet result replaces this placeholder. Later openings show a button
 * instead, so clicking the source file does not silently trigger another
 * conversion every time.
 */
class ClinicalDatasetPreviewProvider
  implements vscode.CustomReadonlyEditorProvider<ClinicalDatasetDocument>, vscode.Disposable
{
  readonly #converter: ClinicalDatasetConverter;

  /**
   * Documents already auto-opened this session.
   *
   * Deliberately kept for the whole session rather than cleared when a document
   * closes: re-opening a source file should show the button, not convert again.
   * It only ever holds one entry per distinct file the user has opened.
   */
  readonly #autoOpened = new Set<string>();
  readonly #listeners = new Set<vscode.Disposable>();

  public constructor(converter: ClinicalDatasetConverter) {
    this.#converter = converter;
  }

  public openCustomDocument(uri: vscode.Uri): ClinicalDatasetDocument {
    return { uri, dispose: noop };
  }

  public async resolveCustomEditor(
    document: ClinicalDatasetDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = renderPreviewHtml(webviewPanel.webview);

    const listener = webviewPanel.webview.onDidReceiveMessage((message: PreviewMessage) => {
      if (message.command !== 'open') {
        return;
      }

      void this.#openDataset(document.uri, webviewPanel);
    });

    this.#listeners.add(listener);
    webviewPanel.onDidDispose(() => {
      listener.dispose();
      this.#listeners.delete(listener);
    });

    const documentKey = document.uri.toString();
    if (this.#autoOpened.has(documentKey)) {
      return;
    }

    this.#autoOpened.add(documentKey);
    await this.#openDataset(document.uri, webviewPanel, { closeOnSuccess: true });
  }

  public dispose(): void {
    for (const listener of this.#listeners) {
      listener.dispose();
    }

    this.#listeners.clear();
    this.#autoOpened.clear();
  }

  /**
   * Converts and opens the dataset, reporting failures in the notification
   * area. Cancellations stay silent.
   *
   * When `closeOnSuccess` is set, the placeholder panel is disposed afterwards
   * because the Parquet file takes its place.
   */
  async #openDataset(
    sourceUri: vscode.Uri,
    webviewPanel: vscode.WebviewPanel,
    options: { closeOnSuccess?: boolean } = {}
  ): Promise<void> {
    try {
      const parquetUri = await convertWithProgress(
        this.#converter,
        sourceUri,
        'Opening clinical dataset'
      );
      await vscode.commands.executeCommand('vscode.open', parquetUri);

      if (options.closeOnSuccess === true) {
        webviewPanel.dispose();
      }
    } catch (error) {
      if (!isCancellation(error)) {
        void vscode.window.showErrorMessage(formatError(error));
      }
    }
  }
}
