import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalDatasetConverter } from '../converter';
import type { DuckDbService } from '../duckdb';
import { OperationCancelledError } from '../errors';
import { resetFileSystem, seedFile, listPaths } from './__mocks__/vscode';

const SOURCE = '/study/adam/adsl.sas7bdat';

/**
 * Stands in for DuckDB.
 *
 * Instead of running SQL it creates the file the `COPY` would have written,
 * which is enough to exercise the converter's caching and cleanup behaviour.
 */
class FakeDuckDb {
  public readonly statements: string[] = [];
  public invalidations = 0;
  public interrupts = 0;
  public shouldFail = false;
  /** Holds the `COPY` open so a test can cancel while it is "running". */
  public pauseOnRun = false;
  #pending: { reject: (error: unknown) => void } | undefined;

  public getSession(): Promise<{ connection: { run: (sql: string) => Promise<void> } }> {
    return Promise.resolve({
      connection: {
        // An arrow property rather than a method so `this` stays bound to the
        // fake without being aliased to a local.
        run: (sql: string): Promise<void> => {
          this.statements.push(sql);

          if (this.shouldFail) {
            return Promise.reject(new Error('read_stat exploded'));
          }

          if (this.pauseOnRun) {
            return new Promise<void>((_resolve, reject) => {
              this.#pending = { reject };
            });
          }

          const target = /TO '([^']+)' \(FORMAT PARQUET\)/.exec(sql)?.[1];
          if (target) {
            seedFile(target, 'parquet bytes');
          }

          return Promise.resolve();
        }
      }
    });
  }

  public invalidate(): void {
    this.invalidations += 1;
  }

  /** Mirrors DuckDB: interrupting rejects the statement that is running. */
  public interrupt(): void {
    this.interrupts += 1;
    this.#pending?.reject(new Error('Query was interrupted'));
    this.#pending = undefined;
  }

  public dispose(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A cancellation token a test can fire on demand.
 *
 * Also counts listener disposals so tests can assert the converter detaches
 * its cancellation listener instead of leaking one per conversion.
 */
function controllableToken(): {
  token: vscode.CancellationToken;
  cancel: () => void;
  disposeCount: () => number;
} {
  // The listener is typed with an optional event so it satisfies vscode's
  // `Event<T>` signature, which always passes one.
  let listener: ((event?: unknown) => void) | undefined;
  let disposals = 0;

  return {
    token: {
      isCancellationRequested: false,
      onCancellationRequested: (callback: (event?: unknown) => void): vscode.Disposable => {
        listener = callback;
        return {
          dispose: () => {
            disposals += 1;
          }
        };
      }
    },
    cancel: () => listener?.(),
    disposeCount: () => disposals
  };
}

function cancelledToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => undefined })
  };
}

function createContext(): vscode.ExtensionContext {
  return {
    globalStorageUri: vscode.Uri.file('/storage')
  } as unknown as vscode.ExtensionContext;
}

function createConverter(duckDb: FakeDuckDb): ClinicalDatasetConverter {
  return new ClinicalDatasetConverter(createContext(), duckDb as unknown as DuckDbService);
}

describe('ClinicalDatasetConverter', () => {
  let duckDb: FakeDuckDb;
  let converter: ClinicalDatasetConverter;

  beforeEach(() => {
    resetFileSystem();
    seedFile(SOURCE, 'source bytes', 1_000);
    duckDb = new FakeDuckDb();
    converter = createConverter(duckDb);
  });

  it('converts a dataset and returns the cached parquet path', async () => {
    const parquetUri = await converter.convert(vscode.Uri.file(SOURCE));

    expect(parquetUri.fsPath).toMatch(/^\/storage\/parquet\/adsl-[0-9a-f]{16}\.parquet$/);
    expect(listPaths()).toContain(parquetUri.fsPath);
  });

  it('creates the cache directory', async () => {
    await converter.convert(vscode.Uri.file(SOURCE));
    expect(listPaths()).toContain('/storage/parquet');
  });

  it('reuses the cached file instead of converting again', async () => {
    const first = await converter.convert(vscode.Uri.file(SOURCE));
    const second = await converter.convert(vscode.Uri.file(SOURCE));

    expect(second.toString()).toBe(first.toString());
    expect(duckDb.statements).toHaveLength(1);
  });

  it('collapses concurrent requests for the same source into one conversion', async () => {
    const uri = vscode.Uri.file(SOURCE);
    const results = await Promise.all([
      converter.convert(uri),
      converter.convert(uri),
      converter.convert(uri)
    ]);

    expect(duckDb.statements).toHaveLength(1);
    expect(new Set(results.map((result) => result.toString())).size).toBe(1);
  });

  it('converts different sources independently', async () => {
    seedFile('/study/adam/ae.sas7bdat', 'other bytes', 1_000);

    const adsl = await converter.convert(vscode.Uri.file(SOURCE));
    const ae = await converter.convert(vscode.Uri.file('/study/adam/ae.sas7bdat'));

    expect(duckDb.statements).toHaveLength(2);
    expect(adsl.toString()).not.toBe(ae.toString());
  });

  it('reports progress through to completion', async () => {
    const messages: string[] = [];
    await converter.convert(vscode.Uri.file(SOURCE), {
      onProgress: (message) => {
        messages.push(message);
      }
    });

    expect(messages).toContain('Preparing cache...');
    expect(messages).toContain('Reading with DuckDB read_stat...');
    expect(messages).toContain('Parquet file ready.');
    expect(messages.at(-1)).toBe('Parquet file ready.');
  });

  it('reuses the cache without reporting a conversion', async () => {
    await converter.convert(vscode.Uri.file(SOURCE));

    const messages: string[] = [];
    await converter.convert(vscode.Uri.file(SOURCE), {
      onProgress: (message) => {
        messages.push(message);
      }
    });

    expect(messages).toContain('Using cached Parquet file.');
    expect(messages).not.toContain('Reading with DuckDB read_stat...');
  });

  it('rejects files that are not clinical datasets', async () => {
    await expect(converter.convert(vscode.Uri.file('/study/adam/adsl.csv'))).rejects.toThrow(
      /supports only/
    );
  });

  it('honours a token that is already cancelled', async () => {
    await expect(
      converter.convert(vscode.Uri.file(SOURCE), { token: cancelledToken() })
    ).rejects.toThrow(OperationCancelledError);

    expect(duckDb.statements).toHaveLength(0);
  });

  it('interrupts the running DuckDB query when the user cancels', async () => {
    duckDb.pauseOnRun = true;
    const { token, cancel } = controllableToken();

    const conversion = converter.convert(vscode.Uri.file(SOURCE), { token });
    await vi.waitFor(() => {
      expect(duckDb.statements).toHaveLength(1);
    });

    cancel();

    // The rejection comes from DuckDB being interrupted rather than from a
    // cancellation check, so the converter must still clean up after it.
    await expect(conversion).rejects.toThrow('Query was interrupted');
    expect(duckDb.interrupts).toBe(1);
    expect(listPaths().filter((path) => path.endsWith('.tmp'))).toEqual([]);
  });

  it('detaches the cancellation listener once the conversion finishes', async () => {
    const { token, disposeCount } = controllableToken();

    await converter.convert(vscode.Uri.file(SOURCE), { token });

    expect(disposeCount()).toBe(1);
  });

  it('leaves no partial file behind when the conversion fails', async () => {
    duckDb.shouldFail = true;

    await expect(converter.convert(vscode.Uri.file(SOURCE))).rejects.toThrow('read_stat exploded');

    const leftovers = listPaths().filter((path) => path.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    expect(listPaths().filter((path) => path.includes('/storage/parquet/adsl-'))).toEqual([]);
  });

  it('invalidates the DuckDB session after a failed statement', async () => {
    duckDb.shouldFail = true;

    await expect(converter.convert(vscode.Uri.file(SOURCE))).rejects.toThrow();
    expect(duckDb.invalidations).toBe(1);
  });

  it('does not memoise a failed conversion', async () => {
    duckDb.shouldFail = true;
    await expect(converter.convert(vscode.Uri.file(SOURCE))).rejects.toThrow();

    duckDb.shouldFail = false;
    await expect(converter.convert(vscode.Uri.file(SOURCE))).resolves.toBeDefined();
    expect(duckDb.statements).toHaveLength(2);
  });

  it('rebuilds the cache when the source changes', async () => {
    const before = await converter.convert(vscode.Uri.file(SOURCE));

    seedFile(SOURCE, 'changed bytes', 9_000);
    const after = await converter.convert(vscode.Uri.file(SOURCE));

    expect(after.toString()).not.toBe(before.toString());
    expect(duckDb.statements).toHaveLength(2);
  });
});
