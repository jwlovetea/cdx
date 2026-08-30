import * as vscode from 'vscode';
import { CdxError } from './errors';

/**
 * Thin wrappers over the VS Code file system API.
 *
 * The API is exception-based: `stat` on a missing path rejects rather than
 * returning `undefined`. These helpers turn that into explicit results so call
 * sites can branch on intent ("does it exist?") instead of on control flow.
 */

/** Returns `true` when `uri` exists, `false` otherwise. */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads file metadata, converting a failure into a user-facing error.
 *
 * @throws {CdxError} if the file cannot be read.
 */
export async function statOrThrow(uri: vscode.Uri): Promise<vscode.FileStat> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (cause) {
    throw new CdxError(`CDX could not read ${uri.fsPath}.`, { cause });
  }
}

/**
 * Deletes `uri`, ignoring failures.
 *
 * Used for cleanup paths where the caller is already handling a more useful
 * error and a stale temporary file is not worth masking it with.
 */
export async function deleteQuietly(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
  } catch {
    // Best effort.
  }
}

/**
 * Deletes `uri` if it exists, ignoring a missing path.
 *
 * Unlike {@link deleteQuietly} this still surfaces genuine failures such as
 * permission errors, which the caller needs to know about.
 */
export async function deleteIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
  } catch (error) {
    if (isFileNotFound(error)) {
      return;
    }

    throw error;
  }
}

/**
 * Recognises the VS Code `FileNotFound` filesystem error.
 *
 * The code is compared by name because the public `vscode` typings do not
 * expose `FileSystemError.FileNotFound()` to runtime consumers here.
 */
function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'FileNotFound';
}
