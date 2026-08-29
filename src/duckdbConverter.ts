import { DuckDBInstance } from '@duckdb/node-api';
import * as vscode from 'vscode';
import { duckdbStringLiteral, requireClinicalDatasetFormat } from './clinicalDataset';

export async function convertClinicalDatasetToParquet(
  sourceUri: vscode.Uri,
  outputUri: vscode.Uri,
  token?: vscode.CancellationToken
): Promise<void> {
  throwIfCancelled(token);

  const format = requireClinicalDatasetFormat(sourceUri.fsPath);
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  try {
    throwIfCancelled(token);
    await connection.run('INSTALL read_stat FROM community');
    await connection.run('LOAD read_stat');

    throwIfCancelled(token);
    const source = duckdbStringLiteral(sourceUri.fsPath);
    const output = duckdbStringLiteral(outputUri.fsPath);
    const formatLiteral = duckdbStringLiteral(format);
    await connection.run(
      `COPY (FROM read_stat(${source}, format = ${formatLiteral})) TO ${output} (FORMAT PARQUET)`
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) {
    throw new Error('CDX conversion was cancelled.');
  }
}
