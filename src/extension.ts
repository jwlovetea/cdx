import { inPositron } from '@posit-dev/positron';
import * as vscode from 'vscode';
import { clearCacheDirectory, ensureCacheDirectory, getCacheDirectoryUri, toFileUri } from './cache';
import { detectClinicalDatasetFormat } from './clinicalDataset';
import { ClinicalDatasetConverter } from './converter';
import { DuckDbService } from './duckdb';
import { CdxError, formatError, isCancellation } from './errors';
import { disposeLog, logInfo, revealLog, logError } from './log';
import { renderPreviewHtml } from './previewHtml';

const COMMAND_OPEN = 'cdx.openClinicalDataset';
const COMMAND_CONVERT = 'cdx.convertClinicalDatasetToParquet';
const COMMAND_CLEAR_CACHE = 'cdx.clearCache';
const COMMAND_SHOW_LOG = 'cdx.showLog';
const COMMAND_OPEN_CACHE = 'cdx.openCacheFolder';

const OPEN_DIALOG_FILTERS: vscode.OpenDialogOptions['filters'] = {
  'Clinical datasets': ['sas7bdat', 'xpt']
};

/** Held at module scope so `deactivate` can shut DuckDB down. */
let duckDb: DuckDbService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  logInfo(`activate (version ${extensionVersion(context)})`);

  const duckDbService = new DuckDbService();
  duckDb = duckDbService;

  const converter = new ClinicalDatasetConverter(context, duckDbService);
  const previewProvider = new ClinicalDatasetPreviewProvider(converter);

  context.subscriptions.push(
    createStatusBar(context),
    registerCommand(COMMAND_SHOW_LOG, () => {
      revealLog();
    })
  );

  context.subscriptions.push(
    previewProvider,
    registerCommand(COMMAND_OPEN, async (uri?: vscode.Uri) => {
      const sourceUri = await resolveClinicalDatasetUri(uri);
      if (!sourceUri) {
        return;
      }

      const parquetUri = await convertWithProgress(converter, sourceUri, 'Opening clinical dataset');
      await openConvertedParquet(parquetUri);

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
    registerCommand(COMMAND_OPEN_CACHE, async () => {
      await ensureCacheDirectory(context);
      await vscode.commands.executeCommand('revealFileInOS', getCacheDirectoryUri(context));
    }),
    vscode.window.registerCustomEditorProvider('cdx.clinicalDatasetPreview', previewProvider, {
      supportsMultipleEditorsPerDocument: false
    })
  );
}

/**
 * Reads the installed version, so the log shows which build is actually live.
 *
 * `packageJSON` is untyped, so the value is narrowed rather than trusted.
 */
function extensionVersion(context: vscode.ExtensionContext): string {
  const metadata: unknown = context.extension.packageJSON;
  const version =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as { version?: unknown }).version
      : undefined;

  return typeof version === 'string' ? version : '?';
}

/**
 * Puts a marker in the status bar so "is CDX actually loaded?" is answerable
 * at a glance.
 *
 * Without it, an extension that failed to activate is indistinguishable from
 * one that converted badly: both leave the user looking at an empty view with
 * no error anywhere. The version is shown so the running build is identifiable.
 */
function createStatusBar(context: vscode.ExtensionContext): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = `CDX ${extensionVersion(context)}`;
  item.tooltip = 'Clinical Data Explorer is active. Click to open the CDX log.';
  item.command = COMMAND_SHOW_LOG;
  item.show();

  return item;
}

/**
 * Releases DuckDB's native resources.
 *
 * Returns the pending shutdown so the extension host waits for it instead of
 * tearing the process down mid-close, which can leak the database file or crash
 * on an in-flight native call.
 */
export function deactivate(): Promise<void> | undefined {
  logInfo('deactivate');
  disposeLog();

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
  handler: (...args: Args) => Promise<void> | void
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
    async (progress, token) => {
      logInfo(`convert: ${sourceUri.fsPath}`);

      try {
        const parquetUri = await converter.convert(sourceUri, {
          token,
          onProgress: (message) => {
            logInfo(`  ${message}`);
            progress.report({ message });
          }
        });

        logInfo(`  -> ${parquetUri.fsPath}`);
        return parquetUri;
      } catch (error) {
        logError(`convert failed for ${sourceUri.fsPath}`, error);
        throw error;
      }
    }
  );
}

/** Returns the size of `uri` in bytes, or -1 if it cannot be read. */
async function statSize(uri: vscode.Uri): Promise<number> {
  try {
    return (await vscode.workspace.fs.stat(uri)).size;
  } catch {
    return -1;
  }
}

interface ClinicalDatasetDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

interface PreviewMessage {
  readonly command?: string;
}

/**
 * Opens the converted Parquet through the normal editor service.
 *
 * In Positron this is the supported path into Data Explorer: the workbench
 * already registers a `*.parquet` editor that imports the file via the
 * built-in `positron-duckdb` backend (`openWithDuckDB` / `open_dataset`).
 *
 * Do not call `positron.dataExplorer.open({ providerId: 'positron-duckdb', ... })`
 * from here. That API is for extensions that register their *own* Data
 * Explorer RPC handler. Hitting the built-in provider from outside goes
 * through the generic extension-backend path, which does not send
 * `open_dataset` and does not use the `duckdb:` dataset-id prefix — so the
 * explorer opens empty or fails. A bare `vscode.open` is the correct entry.
 */
export async function openConvertedParquet(parquetUri: vscode.Uri): Promise<void> {
  // Force file:// — a vscode-userdata cache URI breaks Positron's Data Explorer.
  const fileUri = toFileUri(parquetUri);
  logInfo(`opening converted parquet: ${fileUri.fsPath}`);
  // `preview: false` pins the tab. Without it, vscode.open can replace the
  // custom-editor preview slot, and disposing the placeholder then closes the
  // Data Explorer that just took its place.
  await vscode.commands.executeCommand('vscode.open', fileUri, { preview: false });
}

function noop(): void {
  // Intentionally empty.
}

/**
 * Custom editor shown for `.sas7bdat` and `.xpt` files.
 *
 * Always converts and opens the cached Parquet (cache hit is nearly free),
 * then closes this tab so the Data Explorer takes its place. A short loading
 * state covers the first DuckDB load; failures leave a retryable error page.
 * There is deliberately no "click to open" idle screen — that made every
 * reopen feel like an extra step.
 */
class ClinicalDatasetPreviewProvider
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
    // Always paint something immediately. A blank custom editor while DuckDB
    // loads is indistinguishable from a failed activation.
    webviewPanel.webview.html = renderPreviewHtml(webviewPanel.webview, {
      kind: 'loading',
      message: 'Preparing clinical dataset...'
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

    logInfo(`resolveCustomEditor: ${document.uri.toString()}`);
    await this.#openDataset(document.uri, webviewPanel, { closeOnSuccess: true });
  }

  public dispose(): void {
    for (const listener of this.#listeners) {
      listener.dispose();
    }

    this.#listeners.clear();
  }

  /**
   * Converts and opens the dataset, reporting failures in the notification
   * area and in the placeholder. Cancellations stay silent in the UI.
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

      // Size is logged so an empty result is visible: a zero-byte Parquet
      // opens happily in the Data Explorer and just shows nothing.
      const size = await statSize(parquetUri);
      logInfo(`opening ${parquetUri.fsPath} (${size} bytes)`);

      await openConvertedParquet(parquetUri);

      if (options.closeOnSuccess === true) {
        webviewPanel.dispose();
      }
    } catch (error) {
      // Cancellations stay silent in the UI, but they are exactly the case
      // that looks like "no data", so they go to the log. Failures leave a
      // retryable placeholder instead of a blank webview.
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
