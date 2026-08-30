import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { ensureCacheDirectory, getCachedParquetUri } from './cache';
import { requireClinicalDatasetFormat } from './clinicalDataset';
import type { ClinicalDatasetFormat } from './clinicalDataset';
import type { DuckDbService } from './duckdb';
import { duckdbStringLiteral } from './duckdbSql';
import { OperationCancelledError } from './errors';
import { deleteQuietly, fileExists } from './workspaceFs';

/** Reports human-readable conversion progress to the caller. */
export type ConversionProgressReporter = (message: string) => void;

export interface ConvertOptions {
  /** Cancels the conversion; checked before and during the DuckDB run. */
  readonly token?: vscode.CancellationToken;
  /** Called with progress messages; safe to omit. */
  readonly onProgress?: ConversionProgressReporter;
}

/**
 * Converts clinical datasets to Parquet and caches the result.
 *
 * Responsibilities:
 * - Reuse an already converted file when the source has not changed.
 * - Collapse concurrent requests for the same source into a single conversion.
 * - Write atomically so a cancelled or failed run never leaves a partial file
 *   behind that later runs would happily treat as a cache hit.
 */
export class ClinicalDatasetConverter {
  readonly #context: vscode.ExtensionContext;
  readonly #duckDb: DuckDbService;
  readonly #inFlight = new Map<string, Promise<vscode.Uri>>();

  public constructor(context: vscode.ExtensionContext, duckDb: DuckDbService) {
    this.#context = context;
    this.#duckDb = duckDb;
  }

  /**
   * Returns the cached Parquet file for `sourceUri`, converting it when needed.
   *
   * Concurrent calls for the same source share one conversion.
   */
  public async convert(sourceUri: vscode.Uri, options: ConvertOptions = {}): Promise<vscode.Uri> {
    throwIfCancelled(options.token);

    // Validated before any I/O: the extension check is pure string handling, so
    // an unsupported file is rejected without touching the disk or DuckDB.
    const format = requireClinicalDatasetFormat(sourceUri.fsPath);

    const outputUri = await getCachedParquetUri(this.#context, sourceUri);
    const outputKey = outputUri.toString();

    const pending = this.#inFlight.get(outputKey);
    if (pending) {
      return pending;
    }

    const conversion = this.#convertTo(sourceUri, outputUri, format, options).finally(() => {
      this.#inFlight.delete(outputKey);
    });
    this.#inFlight.set(outputKey, conversion);

    return conversion;
  }

  async #convertTo(
    sourceUri: vscode.Uri,
    outputUri: vscode.Uri,
    format: ClinicalDatasetFormat,
    options: ConvertOptions
  ): Promise<vscode.Uri> {
    const { token, onProgress } = options;

    onProgress?.('Preparing cache...');
    await ensureCacheDirectory(this.#context);
    throwIfCancelled(token);

    if (await fileExists(outputUri)) {
      onProgress?.('Using cached Parquet file.');
      return outputUri;
    }

    onProgress?.('Reading with DuckDB read_stat...');
    await this.#writeParquet(sourceUri, outputUri, format, token);
    onProgress?.('Parquet file ready.');

    return outputUri;
  }

  /**
   * Runs the `COPY` into a temporary file and renames it into place.
   *
   * The temporary file lives next to the final one so the rename stays on the
   * same file system, and is removed if anything goes wrong.
   */
  async #writeParquet(
    sourceUri: vscode.Uri,
    outputUri: vscode.Uri,
    format: ClinicalDatasetFormat,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const tempUri = createTempUri(outputUri);
    const cancellation = token ? this.#duckDb.observeCancellation(token) : undefined;

    try {
      throwIfCancelled(token);
      await this.#copyToParquet(sourceUri, tempUri, format);
      throwIfCancelled(token);
      await vscode.workspace.fs.rename(tempUri, outputUri, { overwrite: true });
    } catch (error) {
      await deleteQuietly(tempUri);
      throw error;
    } finally {
      cancellation?.dispose();
    }
  }

  async #copyToParquet(
    sourceUri: vscode.Uri,
    tempUri: vscode.Uri,
    format: ClinicalDatasetFormat
  ): Promise<void> {
    const { connection } = await this.#duckDb.getSession();

    try {
      await connection.run(
        `COPY (FROM read_stat(${duckdbStringLiteral(sourceUri.fsPath)}, format = ${duckdbStringLiteral(format)})) ` +
          `TO ${duckdbStringLiteral(tempUri.fsPath)} (FORMAT PARQUET)`
      );
    } catch (error) {
      // A failed statement can leave the database unusable, so force the next
      // conversion to start from a clean one.
      this.#duckDb.invalidate();
      throw error;
    }
  }
}

function createTempUri(outputUri: vscode.Uri): vscode.Uri {
  return outputUri.with({ path: `${outputUri.path}.${randomBytes(6).toString('hex')}.tmp` });
}

function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) {
    throw new OperationCancelledError('CDX conversion was cancelled.');
  }
}
