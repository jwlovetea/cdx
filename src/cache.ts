import * as vscode from 'vscode';
import { createCacheFileName, createCacheKey } from './cacheUtils';
import { deleteIfExists, statOrThrow } from './workspaceFs';

const CACHE_DIRECTORY_NAME = 'parquet';

/** Returns the directory where converted Parquet files are cached. */
export function getCacheDirectoryUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, CACHE_DIRECTORY_NAME);
}

/**
 * Creates the cache directory if it does not exist yet and returns it.
 *
 * `vscode.workspace.fs.createDirectory` is recursive and succeeds when the
 * directory is already present, so no existence check is needed first.
 */
export async function ensureCacheDirectory(context: vscode.ExtensionContext): Promise<vscode.Uri> {
  const cacheDirectory = getCacheDirectoryUri(context);
  await vscode.workspace.fs.createDirectory(cacheDirectory);
  return cacheDirectory;
}

/**
 * Computes where the Parquet conversion of `sourceUri` should be cached.
 *
 * This is a pure computation: it reads the source file metadata but does not
 * create anything. Callers that are about to write must call
 * {@link ensureCacheDirectory} first.
 *
 * @throws {CdxError} if the source file cannot be read.
 */
export async function getCachedParquetUri(
  context: vscode.ExtensionContext,
  sourceUri: vscode.Uri
): Promise<vscode.Uri> {
  const stat = await statOrThrow(sourceUri);
  const cacheKey = createCacheKey({
    sourcePath: sourceUri.fsPath,
    modifiedTime: stat.mtime,
    size: stat.size
  });

  return vscode.Uri.joinPath(
    getCacheDirectoryUri(context),
    createCacheFileName(sourceUri.fsPath, cacheKey)
  );
}

/**
 * Removes every cached Parquet file.
 *
 * Clearing an empty cache is a no-op rather than an error: the directory only
 * exists once something has been converted, and reporting "cache cleared" as a
 * failure because there was nothing to clear would be misleading.
 */
export async function clearCacheDirectory(context: vscode.ExtensionContext): Promise<void> {
  await deleteIfExists(getCacheDirectoryUri(context));
}
