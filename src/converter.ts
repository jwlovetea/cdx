import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { ensureCacheDirectory, getCachedParquetUri } from './cache';
import { type ClinicalDatasetFormat, requireClinicalDatasetFormat } from './clinicalDataset';
import type { DuckDbService } from './duckdb';
import { duckdbStringLiteral } from './duckdbSql';
import { CdxError, OperationCancelledError } from './errors';
import { deleteQuietly, fileSize } from './workspaceFs';

/** Reports human-readable conversion progress to the caller. */
export type ConversionProgressReporter = (message: string) => void;

export interface ConvertOptions {
  /** Cancels the conversion; checked before each slow step. */
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

    // Validated before the cache directory is touched so an unsupported
    // extension is reported as such, rather than as a file that cannot be read.
    const format = requireClinicalDatasetFormat(sourceUri.fsPath);

    const outputUri = await getCachedParquetUri(this.#context, sourceUri);
    const outputKey = outputUri.toString();

    const pending = this.#inFlight.get(outputKey);
    if (pending) {
      return pending;
    }

    const conversion = this.#convertTo(sourceUri, outputUri, format, options)
      .then(async (uri) => {
        await this.#assertReadable(uri, sourceUri, options.onProgress);
        return uri;
      })
      .finally(() => {
        this.#inFlight.delete(outputKey);
      });
    this.#inFlight.set(outputKey, conversion);

    return conversion;
  }

  /**
   * Refuses to hand back a Parquet file that would open as an empty grid.
   *
   * Such a file is valid Parquet, so the Data Explorer opens it without
   * complaint and simply shows nothing. That reads as a viewer fault rather
   * than a conversion failure, so it is caught here instead: the entry is
   * dropped from the cache too, otherwise every later open would hit the same
   * dead result.
   */
  async #assertReadable(
    outputUri: vscode.Uri,
    sourceUri: vscode.Uri,
    onProgress?: ConversionProgressReporter
  ): Promise<void> {
    onProgress?.('Checking result...');

    const columnCount = await this.#duckDb.countParquetColumns(outputUri.fsPath);
    if (columnCount !== 0) {
      return;
    }

    await deleteQuietly(outputUri);
    throw new CdxError(
      `CDX converted ${basename(sourceUri.fsPath)} but the result has no columns. ` +
        'See the CDX output channel for details.'
    );
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

    // A zero-byte file counts as a miss. It can only come from a run that
    // failed after creating the file, and opening it would show an empty
    // dataset rather than an error.
    if (((await fileSize(outputUri)) ?? 0) > 0) {
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

    // Cancellation has to reach DuckDB itself: a single COPY over a large
    // dataset runs for minutes, and without this the user's cancel would only
    // take effect after the statement finished.
    //
    // Routed through the service rather than a bare listener because that also
    // clears any interrupt left over from an earlier conversion, which would
    // otherwise cancel this one the moment it started.
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
