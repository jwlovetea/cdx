/**
 * Headless smoke: real DuckDB + compiled converter against testdata/.
 *
 * Unit tests mock `vscode` and DuckDB. This script loads `out/` after
 * `npm run compile` and converts real clinical fixtures, so a broken native
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

/** Fixtures under testdata/ that must convert cleanly. */
const FIXTURES = [
  {
    file: 'adsl.sas7bdat',
    format: 'sas7bdat',
    friendlyName: 'adsl.parquet',
    minColumns: 1,
    minRows: 1
  },
  {
    file: 'dm.xpt',
    format: 'xpt',
    friendlyName: 'dm.parquet',
    minColumns: 1,
    minRows: 1
  }
];

function fail(message) {
  console.error(`smoke FAIL: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`smoke ok: ${message}`);
}

async function smokeOne(converter, duckDb, fixture) {
  const sourcePath = path.join(ROOT, 'testdata', fixture.file);
  if (!fs.existsSync(sourcePath)) {
    fail(`missing fixture ${sourcePath}`);
  }

  const sourceUri = require('./vscode-stub.cjs').Uri.file(sourcePath);
  const parquetUri = await converter.convert(sourceUri);
  const parquetPath = parquetUri.fsPath;

  if (!fs.existsSync(parquetPath)) {
    fail(`converter returned a missing path: ${parquetPath}`);
  }

  const size = fs.statSync(parquetPath).size;
  if (size <= 0) {
    fail(`parquet is empty: ${parquetPath}`);
  }

  const base = path.basename(parquetPath);
  if (base.toLowerCase() !== fixture.friendlyName.toLowerCase()) {
    fail(`expected friendly name ${fixture.friendlyName}, got ${base}`);
  }

  const metaPath = path.join(path.dirname(parquetPath), 'source-meta.json');
  if (!fs.existsSync(metaPath)) {
    fail(`missing cache meta: ${metaPath}`);
  }

  const columns = await duckDb.countParquetColumns(parquetPath);
  if (columns < fixture.minColumns) {
    fail(`${fixture.file}: parquet reported ${columns} columns`);
  }

  const { connection } = await duckDb.getSession();
  const reader = await connection.runAndReadAll(
    `SELECT count(*) AS n FROM read_parquet('${parquetPath.replaceAll("'", "''")}')`
  );
  const rows = Number(reader.getRowObjects()[0]?.['n'] ?? -1);
  if (rows < fixture.minRows) {
    fail(`${fixture.file}: parquet reported ${rows} rows`);
  }

  const reused = await converter.convert(sourceUri);
  if (reused.fsPath !== parquetPath) {
    fail(`cache hit returned a different path: ${reused.fsPath}`);
  }

  ok(`converted testdata/${fixture.file} (${fixture.format}) -> ${base}`);
  ok(`  ${size} bytes, ${columns} columns, ${rows} rows`);
}

async function main() {
  if (!fs.existsSync(path.join(OUT, 'converter.js'))) {
    fail(`missing ${path.join(OUT, 'converter.js')} — run npm run compile first`);
  }

  const vscode = require('./vscode-stub.cjs');
  const { DuckDbService } = require(path.join(OUT, 'duckdb.js'));
  const { ClinicalDatasetConverter } = require(path.join(OUT, 'converter.js'));

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cdx-smoke-'));
  const context = { globalStorageUri: vscode.Uri.file(storage) };

  ok(`storage ${storage}`);

  const duckDb = new DuckDbService();
  const converter = new ClinicalDatasetConverter(context, duckDb);

  try {
    for (const fixture of FIXTURES) {
      await smokeOne(converter, duckDb, fixture);
    }

    console.log('smoke PASS');
  } finally {
    await duckDb.dispose();
    fs.rmSync(storage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
