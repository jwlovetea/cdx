import * as vscode from 'vscode';
import { toFileUri } from './cache';
import type { ClinicalDatasetConverter } from './converter';
import { formatError, isCancellation } from './errors';
import { logError, logInfo } from './log';

/** Opens the converted Parquet through the normal editor service. */
export async function openConvertedParquet(parquetUri: vscode.Uri): Promise<void> {
  // Force file:// — a vscode-userdata cache URI breaks Positron's Data Explorer.
  const fileUri = toFileUri(parquetUri);
  logInfo(`opening converted parquet: ${fileUri.fsPath}`);
  // `preview: false` pins the tab so disposing a placeholder cannot close it.
  await vscode.commands.executeCommand('vscode.open', fileUri, { preview: false });
}

export async function convertWithProgress(
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

/** Shows Open / Reveal actions after a successful convert-only command. */
export async function notifyConverted(parquetUri: vscode.Uri): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `CDX wrote ${parquetUri.fsPath}`,
    'Open',
    'Reveal'
  );

  if (choice === 'Open') {
    await openConvertedParquet(parquetUri);
    return;
  }

  if (choice === 'Reveal') {
    await vscode.commands.executeCommand('revealFileInOS', toFileUri(parquetUri));
  }
}

/** Returns the size of `uri` in bytes, or -1 if it cannot be read. */
export async function statSize(uri: vscode.Uri): Promise<number> {
  try {
    return (await vscode.workspace.fs.stat(uri)).size;
  } catch {
    return -1;
  }
}

export function reportCommandError(error: unknown): void {
  if (isCancellation(error)) {
    return;
  }

  void vscode.window.showErrorMessage(formatError(error));
}
