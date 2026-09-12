import * as vscode from 'vscode';
import { ClinicalDatasetConverter } from './converter';
import { ClinicalDatasetPreviewProvider } from './clinicalDatasetEditor';
import { registerCommands } from './commands';
import { DuckDbService } from './duckdb';
import { disposeLog, logInfo } from './log';

const CUSTOM_EDITOR_VIEW_TYPE = 'cdx.clinicalDatasetPreview';

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
    previewProvider,
    ...registerCommands(context, converter),
    vscode.window.registerCustomEditorProvider(CUSTOM_EDITOR_VIEW_TYPE, previewProvider, {
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
 */
function createStatusBar(context: vscode.ExtensionContext): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = `CDX ${extensionVersion(context)}`;
  item.tooltip = 'Clinical Data Explorer is active. Click to open the CDX log.';
  item.command = 'cdx.showLog';
  item.show();

  return item;
}

/**
 * Releases DuckDB's native resources.
 *
 * Returns the pending shutdown so the extension host waits for it instead of
 * tearing the process down mid-close.
 */
export function deactivate(): Promise<void> | undefined {
  logInfo('deactivate');
  disposeLog();

  const service = duckDb;
  duckDb = undefined;
  return service?.dispose();
}

// Re-exported for tests that exercise the open path.
export { openConvertedParquet } from './openDataset';
