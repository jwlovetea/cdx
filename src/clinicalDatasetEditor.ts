import * as vscode from 'vscode';
import type { ClinicalDatasetConverter } from './converter';
import { formatError, isCancellation } from './errors';
import { logError, logInfo, revealLog } from './log';
import { convertWithProgress, openConvertedParquet, statSize } from './openDataset';
import { isAutoOpenEnabled } from './settings';
import { renderPreviewHtml } from './previewHtml';

export interface ClinicalDatasetDocument extends vscode.CustomDocument {
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
 * With `cdx.autoOpen` on (default), converts and opens the cached Parquet,
 * then closes this tab. With it off, waits for an explicit Open click.
 * Failures leave a retryable error page.
 */
export class ClinicalDatasetPreviewProvider
  implements vscode.CustomReadonlyEditorProvider<ClinicalDatasetDocument>, vscode.Disposable
{
  readonly #converter: ClinicalDatasetConverter;
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

    const autoOpen = isAutoOpenEnabled();
    webviewPanel.webview.html = renderPreviewHtml(webviewPanel.webview, {
      kind: autoOpen ? 'loading' : 'ready',
      message: autoOpen ? 'Preparing clinical dataset...' : undefined
    });

    const listener = webviewPanel.webview.onDidReceiveMessage((message: PreviewMessage) => {
      if (message.command !== 'open') {
        return;
      }

      void this.#openDataset(document.uri, webviewPanel, { closeOnSuccess: true });
    });

    this.#listeners.add(listener);
    webviewPanel.onDidDispose(() => {
      listener.dispose();
      this.#listeners.delete(listener);
    });

    logInfo(`resolveCustomEditor: ${document.uri.toString()} autoOpen=${autoOpen}`);

    if (autoOpen) {
      await this.#openDataset(document.uri, webviewPanel, { closeOnSuccess: true });
    }
  }

  public dispose(): void {
    for (const listener of this.#listeners) {
      listener.dispose();
    }

    this.#listeners.clear();
  }

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

      const size = await statSize(parquetUri);
      logInfo(`opening ${parquetUri.fsPath} (${size} bytes)`);

      await openConvertedParquet(parquetUri);

      if (options.closeOnSuccess === true) {
        webviewPanel.dispose();
      }
    } catch (error) {
      logError(`openDataset ${sourceUri.fsPath}`, error);
      webviewPanel.webview.html = renderPreviewHtml(webviewPanel.webview, {
        kind: 'error',
        message: formatError(error)
      });

      if (!isCancellation(error)) {
        void vscode.window.showErrorMessage(formatError(error));
        revealLog();
      }
    }
  }
}
