import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

/** Metadata that identifies a cached conversion of a source dataset. */
export interface CacheInput {
  readonly sourcePath: string;
  readonly modifiedTime: number;
  readonly size: number;
}

/**
 * Upper bound for the human readable part of a cache file name.
 *
 * Most file systems cap a single path component at 255 bytes; the remainder is
 * reserved for the `-<hash>.parquet` suffix appended by
 * {@link createCacheFileName}.
 */
const MAX_BASE_NAME_LENGTH = 200;

/** Fallback used when a source name sanitises down to nothing usable. */
const DEFAULT_BASE_NAME = 'dataset';

/** Device names that are reserved on Windows in every directory. */
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

/**
 * Builds a stable cache key from the source path and the file metadata that
 * signals a content change.
 *
 * The fields are joined with a NUL separator so that no combination of values
 * can produce the same byte stream as a different combination.
 */
export function createCacheKey(input: CacheInput): string {
  return createHash('sha256')
    .update(input.sourcePath)
    .update('\0')
    .update(String(input.modifiedTime))
    .update('\0')
    .update(String(input.size))
    .digest('hex');
}

/**
 * Builds the cache file name for a source dataset.
 *
 * The name keeps a sanitised copy of the source base name for debuggability and
 * appends a hash prefix to keep entries unique.
 */
export function createCacheFileName(sourcePath: string, cacheKey: string): string {
  return `${sanitizeBaseName(sourcePath)}-${cacheKey.slice(0, 16)}.parquet`;
}

/**
 * Reduces a source path to a file-system safe base name.
 *
 * Characters outside `[A-Za-z0-9._-]` are replaced with `_`, leading dots and
 * dashes (which would create hidden files or look like CLI flags) are stripped,
 * and names that are empty or reserved on Windows fall back to `dataset`.
 */
export function sanitizeBaseName(sourcePath: string): string {
  const raw = basename(sourcePath, extname(sourcePath));
  const replaced = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[.-]+/, '');
  // Trailing dots and spaces are not addressable on Windows, so drop them too.
  const truncated = replaced.slice(0, MAX_BASE_NAME_LENGTH).replace(/[.-]+$/, '');

  if (truncated.length === 0 || isReservedName(truncated)) {
    return DEFAULT_BASE_NAME;
  }

  return truncated;
}

function isReservedName(name: string): boolean {
  return RESERVED_WINDOWS_NAMES.has(name.split('.', 1)[0]?.toUpperCase() ?? '');
}
