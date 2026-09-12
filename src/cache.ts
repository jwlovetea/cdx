import * as vscode from 'vscode';
import { createCacheFileName, createSourceCacheDirectoryName } from './cacheUtils';
import { deleteIfExists, deleteQuietly, statOrThrow } from './workspaceFs';

const CACHE_DIRECTORY_NAME = 'parquet';
const META_FILE_NAME = 'source-meta.json';

/** Records which source metadata produced the cached Parquet next to it. */
interface CacheMeta {
  readonly sourcePath: string;
  readonly modifiedTime: number;
  readonly size: number;
}

/**
 * Returns the directory where converted Parquet files are cached.
 *
 * Always a `file://` URI. Positron can expose `globalStorageUri` as
 * `vscode-userdata:`, which `workspace.fs` accepts but Data Explorer does not:
 * opening that URI produces "Unable to resolve filesystem provider with
 * relative file path 'positron-data-explorer:...vscode-userdata:...'". The
 * on-disk location is the same, so converting the scheme is enough.
 */
export function getCacheDirectoryUri(context: vscode.ExtensionContext): vscode.Uri {
  return toFileUri(vscode.Uri.joinPath(context.globalStorageUri, CACHE_DIRECTORY_NAME));
}

/** Normalises a URI to `file://`, which DuckDB and Data Explorer both need. */
export function toFileUri(uri: vscode.Uri): vscode.Uri {
  return uri.scheme === 'file' ? uri : vscode.Uri.file(uri.fsPath);
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

/** One folder per source path, so friendly file names cannot collide. */
export function getCacheEntryDirectory(
  context: vscode.ExtensionContext,
  sourceUri: vscode.Uri
): vscode.Uri {
  return vscode.Uri.joinPath(
    getCacheDirectoryUri(context),
    createSourceCacheDirectoryName(sourceUri.fsPath)
  );
}

/**
 * Computes where the Parquet conversion of `sourceUri` should be cached.
 *
 * Layout is `parquet/<source-path-hash>/<FriendlyName>.parquet`. The folder
 * keeps distinct source paths apart; the file name stays human-readable so
 * Data Explorer titles read `adsl.parquet` rather than a hash suffix.
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
  await statOrThrow(sourceUri);

  return vscode.Uri.joinPath(
    getCacheEntryDirectory(context, sourceUri),
    createCacheFileName(sourceUri.fsPath)
  );
}

/** True when the cached Parquet was produced from the source's current metadata. */
export async function isCacheEntryFresh(
  context: vscode.ExtensionContext,
  sourceUri: vscode.Uri
): Promise<boolean> {
  const meta = await readCacheMeta(metaUriFor(context, sourceUri));
  if (!meta) {
    return false;
  }

  try {
    const stat = await statOrThrow(sourceUri);
    return (
      meta.sourcePath === sourceUri.fsPath &&
      meta.modifiedTime === stat.mtime &&
      meta.size === stat.size
    );
  } catch {
    return false;
  }
}

/**
 * Records the source metadata that produced the cache entry for `sourceUri`.
 *
 * Creates the per-source folder if needed so a write never lands outside it.
 */
export async function writeCacheMeta(
  context: vscode.ExtensionContext,
  sourceUri: vscode.Uri
): Promise<void> {
  const entryDirectory = getCacheEntryDirectory(context, sourceUri);
  await vscode.workspace.fs.createDirectory(entryDirectory);

  const stat = await statOrThrow(sourceUri);
  const meta: CacheMeta = {
    sourcePath: sourceUri.fsPath,
    modifiedTime: stat.mtime,
    size: stat.size
  };

  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(entryDirectory, META_FILE_NAME),
    new TextEncoder().encode(JSON.stringify(meta))
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

/**
 * Deletes cache leftovers that are not part of the current layout.
 *
 * The old flat scheme wrote `basename-<hash>.parquet` files into the cache
 * root; the new scheme uses one folder per source with a friendly file name.
 * Orphaned `*.tmp` files from a crashed write are removed too.
 */
export async function pruneStaleCacheEntries(context: vscode.ExtensionContext): Promise<void> {
  const cacheDirectory = getCacheDirectoryUri(context);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(cacheDirectory);
  } catch {
    return;
  }

  for (const [name, type] of entries) {
    if (type === vscode.FileType.Directory) {
      await pruneTempFilesIn(vscode.Uri.joinPath(cacheDirectory, name));
      continue;
    }

    if (name.endsWith('.tmp') || name.endsWith('.parquet') || name === META_FILE_NAME) {
      await deleteQuietly(vscode.Uri.joinPath(cacheDirectory, name));
    }
  }
}

async function pruneTempFilesIn(directoryUri: vscode.Uri): Promise<void> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(directoryUri);
  } catch {
    return;
  }

  for (const [name, type] of entries) {
    if (type === vscode.FileType.File && name.endsWith('.tmp')) {
      await deleteQuietly(vscode.Uri.joinPath(directoryUri, name));
    }
  }
}

function metaUriFor(context: vscode.ExtensionContext, sourceUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(getCacheEntryDirectory(context, sourceUri), META_FILE_NAME);
}

async function readCacheMeta(metaUri: vscode.Uri): Promise<CacheMeta | undefined> {
  try {
    const raw = await vscode.workspace.fs.readFile(metaUri);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CacheMeta).sourcePath === 'string' &&
      typeof (parsed as CacheMeta).modifiedTime === 'number' &&
      typeof (parsed as CacheMeta).size === 'number'
    ) {
      return parsed as CacheMeta;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
