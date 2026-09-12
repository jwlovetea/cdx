import { inPositron } from '@posit-dev/positron';
import * as vscode from 'vscode';
import {
  clearCacheDirectory,
  ensureCacheDirectory,
  getCacheDirectoryUri
} from './cache';
import { detectClinicalDatasetFormat } from './clinicalDataset';
import type { ClinicalDatasetConverter } from './converter';
import { CdxError } from './errors';
import { logInfo, revealLog } from './log';
import {
  convertWithProgress,
  notifyConverted,
  openConvertedParquet,
  reportCommandError
} from './openDataset';

export const COMMAND_OPEN = 'cdx.openClinicalDataset';
export const COMMAND_CONVERT = 'cdx.convertClinicalDatasetToParquet';
export const COMMAND_CLEAR_CACHE = 'cdx.clearCache';
export const COMMAND_SHOW_LOG = 'cdx.showLog';
export const COMMAND_OPEN_CACHE = 'cdx.openCacheFolder';

const OPEN_DIALOG_FILTERS: vscode.OpenDialogOptions['filters'] = {
  'Clinical datasets': ['sas7bdat', 'xpt']
};

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
      reportCommandError(error);
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
    return undefined;
  }

  if (!detectClinicalDatasetFormat(chosen.fsPath)) {
    throw new CdxError(`CDX supports only .sas7bdat and .xpt files: ${chosen.fsPath}`);
  }

  return chosen;
}

async function confirmClearCache(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    'Delete all cached Parquet files created by CDX?',
    { modal: true, detail: 'Sources are not deleted. Datasets will be converted again on next open.' },
    'Delete'
  );

  return choice === 'Delete';
}

export function registerCommands(
  context: vscode.ExtensionContext,
  converter: ClinicalDatasetConverter
): vscode.Disposable[] {
  return [
    registerCommand(COMMAND_SHOW_LOG, () => {
      revealLog();
    }),
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
      await notifyConverted(parquetUri);
    }),
    registerCommand(COMMAND_CLEAR_CACHE, async () => {
      if (!(await confirmClearCache())) {
        logInfo('clearCache cancelled by user');
        return;
      }

      await clearCacheDirectory(context);
      void vscode.window.showInformationMessage('CDX cache cleared.');
    }),
    registerCommand(COMMAND_OPEN_CACHE, async () => {
      await ensureCacheDirectory(context);
      await vscode.commands.executeCommand('revealFileInOS', getCacheDirectoryUri(context));
    })
  ];
}
