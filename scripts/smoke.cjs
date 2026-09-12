/**
 * Headless smoke: real DuckDB + compiled converter against testdata/.
 *
 * Unit tests mock `vscode` and DuckDB. This script loads `out/` after
 * `npm run compile` and converts a real .sas7bdat, so a broken native
 * binding, a bad read_stat install, or a cache write regression fails loudly
 * before packaging.
 *
 * Usage: npm run compile && npm run smoke
 */
'use strict';

require('./vscode-stub.cjs');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const SOURCE = path.join(ROOT, 'testdata', 'adsl.sas7bdat');

function fail(message) {
  console.error(`smoke FAIL: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`smoke ok: ${message}`);
}

async function main() {
  if (!fs.existsSync(path.join(OUT, 'converter.js'))) {
    fail(`missing ${path.join(OUT, 'converter.js')} — run npm run compile first`);
  }

  if (!fs.existsSync(SOURCE)) {
    fail(`missing fixture ${SOURCE}`);
  }

  const vscode = require('./vscode-stub.cjs');
  const { DuckDbService } = require(path.join(OUT, 'duckdb.js'));
  const { ClinicalDatasetConverter } = require(path.join(OUT, 'converter.js'));

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cdx-smoke-'));
  const context = { globalStorageUri: vscode.Uri.file(storage) };

  ok(`storage ${storage}`);
  ok(`source ${SOURCE} (${fs.statSync(SOURCE).size} bytes)`);

  const duckDb = new DuckDbService();
  const converter = new ClinicalDatasetConverter(context, duckDb);

  try {
    const parquetUri = await converter.convert(vscode.Uri.file(SOURCE));
    const parquetPath = parquetUri.fsPath;

    if (!fs.existsSync(parquetPath)) {
      fail(`converter returned a missing path: ${parquetPath}`);
    }

    const size = fs.statSync(parquetPath).size;
    if (size <= 0) {
      fail(`parquet is empty: ${parquetPath}`);
    }

    const base = path.basename(parquetPath);
    if (!/^adsl\.parquet$/i.test(base)) {
      fail(`expected friendly name adsl.parquet, got ${base}`);
    }

    const metaPath = path.join(path.dirname(parquetPath), 'source-meta.json');
    if (!fs.existsSync(metaPath)) {
      fail(`missing cache meta: ${metaPath}`);
    }

    const columns = await duckDb.countParquetColumns(parquetPath);
    if (columns <= 0) {
      fail(`parquet reported ${columns} columns`);
    }

    const { connection } = await duckDb.getSession();
    const reader = await connection.runAndReadAll(
      `SELECT count(*) AS n FROM read_parquet('${parquetPath.replaceAll("'", "''")}')`
    );
    const rows = Number(reader.getRowObjects()[0]?.['n'] ?? -1);
    if (rows <= 0) {
      fail(`parquet reported ${rows} rows`);
    }

    // Second convert must be a cache hit (same friendly path).
    const reused = await converter.convert(vscode.Uri.file(SOURCE));
    if (reused.fsPath !== parquetPath) {
      fail(`cache hit returned a different path: ${reused.fsPath}`);
    }

    ok(`converted ${path.relative(ROOT, SOURCE)} -> ${path.relative(ROOT, parquetPath)}`);
    ok(`parquet ${size} bytes, ${columns} columns, ${rows} rows`);
    ok(`cache meta + friendly name verified`);

    console.log('smoke PASS');
  } finally {
    await duckDb.dispose();
    fs.rmSync(storage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
