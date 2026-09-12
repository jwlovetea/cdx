import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCacheDirectory,
  ensureCacheDirectory,
  enforceCacheBudget,
  getCacheDirectoryUri,
  getCachedParquetUri,
  pruneStaleCacheEntries
} from '../cache';
import { CdxError } from '../errors';
import { listPaths, resetFileSystem, seedFile } from './__mocks__/vscode';

const SOURCE = '/study/adam/adsl.sas7bdat';

function createContext(): vscode.ExtensionContext {
  return {
    globalStorageUri: vscode.Uri.file('/storage')
  } as unknown as vscode.ExtensionContext;
}

describe('cache', () => {
  beforeEach(() => {
    resetFileSystem();
    seedFile(SOURCE, 'dataset', 1_000);
  });

  describe('getCacheDirectoryUri', () => {
    it('places the cache under global storage', () => {
      expect(getCacheDirectoryUri(createContext()).fsPath).toBe('/storage/parquet');
    });

    it('rewrites a vscode-userdata globalStorage URI to file://', () => {
      // Positron exposes globalStorageUri as vscode-userdata. Data Explorer
      // cannot open that scheme; DuckDB needs a real filesystem path.
      const context = {
        globalStorageUri: vscode.Uri.file(
          '/Users/hhm/Library/Application Support/Positron/User/globalStorage/local.cdx'
        ).with({ scheme: 'vscode-userdata' })
      } as unknown as vscode.ExtensionContext;

      const uri = getCacheDirectoryUri(context);

      expect(uri.scheme).toBe('file');
      expect(uri.fsPath).toBe(
        '/Users/hhm/Library/Application Support/Positron/User/globalStorage/local.cdx/parquet'
      );
    });
  });

  describe('ensureCacheDirectory', () => {
    it('creates the directory', async () => {
      await ensureCacheDirectory(createContext());
      expect(listPaths()).toContain('/storage/parquet');
    });

    it('is idempotent', async () => {
      await ensureCacheDirectory(createContext());
      await ensureCacheDirectory(createContext());
      expect(listPaths().filter((path) => path === '/storage/parquet')).toHaveLength(1);
    });
  });

  describe('getCachedParquetUri', () => {
    it('returns a stable friendly path for the same source path', async () => {
      const context = createContext();
      const first = await getCachedParquetUri(context, vscode.Uri.file(SOURCE));
      const second = await getCachedParquetUri(context, vscode.Uri.file(SOURCE));

      expect(first.toString()).toBe(second.toString());
    });

    it('keeps the same path when the source content changes', async () => {
      // Freshness is tracked in a sidecar meta file, not in the file name,
      // so Data Explorer always shows `adsl.parquet`.
      const context = createContext();
      const before = await getCachedParquetUri(context, vscode.Uri.file(SOURCE));

      seedFile(SOURCE, 'dataset but newer', 2_000);
      const after = await getCachedParquetUri(context, vscode.Uri.file(SOURCE));

      expect(after.toString()).toBe(before.toString());
    });

    it('names the file after the source dataset without a hash suffix', async () => {
      const uri = await getCachedParquetUri(createContext(), vscode.Uri.file(SOURCE));

      expect(uri.fsPath).toMatch(/^\/storage\/parquet\/[0-9a-f]{16}\/adsl\.parquet$/);
    });

    it('throws a user-facing error when the source is missing', async () => {
      await expect(
        getCachedParquetUri(createContext(), vscode.Uri.file('/study/missing.sas7bdat'))
      ).rejects.toThrow(CdxError);
    });
  });

  describe('enforceCacheBudget', () => {
    it('is a no-op when the cap is unlimited', async () => {
      const context = createContext();
      await ensureCacheDirectory(context);
      seedFile('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet', 'x'.repeat(100));

      await enforceCacheBudget(context, 0);

      expect(listPaths()).toContain('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet');
    });

    it('deletes oldest folders until the cache fits, keeping the newest', async () => {
      const context = createContext();
      await ensureCacheDirectory(context);
      // Two 100-byte files; cap of 150 forces one deletion.
      seedFile('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet', 'x'.repeat(100), 1_000);
      seedFile('/storage/parquet/bbbbbbbbbbbbbbbb/ae.parquet', 'y'.repeat(100), 2_000);

      await enforceCacheBudget(context, 150, 'bbbbbbbbbbbbbbbb');

      expect(listPaths()).not.toContain('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet');
      expect(listPaths()).toContain('/storage/parquet/bbbbbbbbbbbbbbbb/ae.parquet');
    });

    it('never deletes the folder just written', async () => {
      const context = createContext();
      await ensureCacheDirectory(context);
      seedFile('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet', 'x'.repeat(200), 5_000);

      await enforceCacheBudget(context, 50, 'aaaaaaaaaaaaaaaa');

      expect(listPaths()).toContain('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet');
    });
  });

  describe('pruneStaleCacheEntries', () => {
    it('removes legacy flat cache files at the cache root', async () => {
      const context = createContext();
      await ensureCacheDirectory(context);
      seedFile('/storage/parquet/adsl-bbbbbbbbbbbbbbbb.parquet', 'old layout');

      await pruneStaleCacheEntries(context);

      expect(listPaths()).not.toContain('/storage/parquet/adsl-bbbbbbbbbbbbbbbb.parquet');
    });

    it('removes orphaned temporary write files inside a source folder', async () => {
      const context = createContext();
      await ensureCacheDirectory(context);
      seedFile('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet', 'new');
      seedFile('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet.deadbeef.tmp', 'partial');

      await pruneStaleCacheEntries(context);

      expect(listPaths()).not.toContain(
        '/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet.deadbeef.tmp'
      );
      expect(listPaths()).toContain('/storage/parquet/aaaaaaaaaaaaaaaa/adsl.parquet');
    });

    it('is a no-op when the cache directory does not exist', async () => {
      await expect(pruneStaleCacheEntries(createContext())).resolves.toBeUndefined();
    });
  });

  describe('clearCacheDirectory', () => {
    it('removes cached files', async () => {
      const context = createContext();
      await ensureCacheDirectory(context);
      seedFile('/storage/parquet/adsl-abc.parquet', 'parquet');

      await clearCacheDirectory(context);

      expect(listPaths()).not.toContain('/storage/parquet/adsl-abc.parquet');
    });

    it('is a no-op when nothing has been cached yet', async () => {
      await expect(clearCacheDirectory(createContext())).resolves.toBeUndefined();
    });

    it('does not touch the source dataset', async () => {
      await clearCacheDirectory(createContext());
      expect(listPaths()).toContain(SOURCE);
    });
  });
});
