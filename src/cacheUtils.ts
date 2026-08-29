import * as crypto from 'node:crypto';
import * as path from 'node:path';

export interface CacheInput {
  sourcePath: string;
  modifiedTime: number;
  size: number;
}

export function createCacheKey(input: CacheInput): string {
  return crypto
    .createHash('sha256')
    .update(input.sourcePath)
    .update('\0')
    .update(String(input.modifiedTime))
    .update('\0')
    .update(String(input.size))
    .digest('hex');
}

export function createCacheFileName(sourcePath: string, cacheKey: string): string {
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const safeBaseName = baseName.replace(/[^A-Za-z0-9._-]+/g, '_') || 'dataset';
  return `${safeBaseName}-${cacheKey.slice(0, 16)}.parquet`;
}
