# Clinical Data Explorer

CDX opens `.sas7bdat` and `.xpt` clinical datasets through DuckDB's `read_stat` community extension, converts them to cached Parquet files, and opens the result in the editor.

In Positron, Parquet files are handled by the native Data Explorer. In VS Code, CDX still converts the source file and opens the generated Parquet file with whatever Parquet viewer is available.

## Commands

- `CDX: Open Clinical Dataset`
- `CDX: Convert Clinical Dataset to Parquet`
- `CDX: Clear CDX Cache`

The open and convert commands are also available from the Explorer context menu for `.sas7bdat` and `.xpt` files.

## Development

```sh
npm run typecheck   # types across src, tests and configs
npm run lint        # eslint, type-aware rules
npm test            # vitest, once
npm run test:watch  # vitest, watch mode
npm run check       # all three, in order
```

Tests run outside the extension host, so `vscode` is aliased to an in-memory
stub at `src/test/__mocks__/vscode.ts`. It implements enough of `Uri` and
`workspace.fs` for the cache and converter layers to be exercised directly.

## Layout

| Module | Responsibility |
| --- | --- |
| `extension.ts` | Command and custom editor registration; user-facing messaging |
| `converter.ts` | Cache reuse, in-flight de-duplication, atomic writes, cancellation |
| `duckdb.ts` | Owns the shared DuckDB database and the `read_stat` extension |
| `duckdbSql.ts` | SQL literal and identifier quoting |
| `cache.ts` / `cacheUtils.ts` | Cache paths, keys and file name sanitising |
| `workspaceFs.ts` | Exception-based `workspace.fs` calls as explicit results |
| `errors.ts` | Error types; deliberately free of any `vscode` import |

DuckDB is started once per activation and reused, because opening it and
resolving `read_stat` costs hundreds of milliseconds. Conversions write to a
temporary file and rename it into place, so a cancelled or failed run cannot
leave a partial file that a later run would treat as a cache hit. Cancelling
interrupts the running `COPY` rather than waiting for it to finish.

## Packaging

Build the extension before packaging:

```sh
npm run compile
npx @vscode/vsce package
```

The VSIX must include `node_modules/@duckdb` and `node_modules/@posit-dev`; CDX needs those runtime dependencies after installation.

Packaging only ships the binding for the platform it runs on. Package on
each platform you intend to support.

### `vsce package` fails with `ELSPROBLEMS`

`vsce` runs `npm list --production` to work out which dependencies to ship,
and aborts if npm reports anything invalid. npm 10 can leave empty
directories behind for the `@duckdb/node-bindings-*` packages it correctly
skips on `os`/`cpu` mismatch, and npm then reports each one as invalid:

```sh
npm error invalid: @duckdb/node-bindings-linux-x64@ .../node_modules/@duckdb/node-bindings-linux-x64
```

Remove the empty directories and package again:

```sh
find node_modules/@duckdb -type d -empty -print -delete
vsce package
```

This is safe: only the host platform's binding is populated, the rest are
empty shells left over from a skipped install. A future `npm install` can
recreate them.

## Notes

DuckDB installs `read_stat` from the community extension repository the first time it is used:

```sql
INSTALL read_stat FROM community;
LOAD read_stat;
```

That first run may need network access. Converted Parquet files are cached in the extension global storage directory and regenerated when the source path, modified time, or size changes.
