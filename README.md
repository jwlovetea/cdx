# Clinical Data Explorer

CDX opens `.sas7bdat` and `.xpt` clinical datasets through DuckDB's `read_stat` community extension, converts them to cached Parquet files, and opens the result in the editor.

In Positron, Parquet files are handled by the native Data Explorer. In VS Code, CDX still converts the source file and opens the generated Parquet file with whatever Parquet viewer is available.

## Commands

- `CDX: Open Clinical Dataset`
- `CDX: Convert Clinical Dataset to Parquet`
- `CDX: Clear CDX Cache`
- `CDX: Open Cache Folder`
- `CDX: Show Log`

The open and convert commands are also available from the Explorer context menu for `.sas7bdat` and `.xpt` files.

## Development

```sh
npm run typecheck   # types across src, tests and configs
npm run lint        # eslint, type-aware rules
npm test            # vitest, once
npm run test:watch  # vitest, watch mode
npm run check       # typecheck + lint + unit tests
npm run compile     # tsc -> out/
npm run smoke       # real DuckDB convert of testdata/ (after compile)
```

Tests run outside the extension host, so `vscode` is aliased to an in-memory
stub at `src/test/__mocks__/vscode.ts`. It implements enough of `Uri` and
`workspace.fs` for the cache and converter layers to be exercised directly.

`npm run smoke` is the headless end-to-end check: it loads the compiled
`out/` modules with a `vscode` stub (`scripts/vscode-stub.cjs`) and converts
`testdata/adsl.sas7bdat` with real DuckDB `read_stat`. That catches native
binding, install, and cache-write regressions unit tests cannot see.

Sample clinical files live in `testdata/` (`adsl.sas7bdat`, `dm.xpt`) and are
not shipped in the VSIX. `npm run smoke` converts both formats with real DuckDB.

## Layout

| Module | Responsibility |
| --- | --- |
| `extension.ts` | Activation, status bar, custom editor wiring |
| `commands.ts` | Command palette / context menu handlers |
| `openDataset.ts` | Convert-with-progress and open Parquet in the editor |
| `clinicalDatasetEditor.ts` | Custom editor for `.sas7bdat` / `.xpt` |
| `converter.ts` | Cache reuse, in-flight de-duplication, atomic writes, cancellation |
| `duckdb.ts` | Owns the shared DuckDB database and the `read_stat` extension |
| `duckdbSql.ts` | SQL literal and identifier quoting |
| `cache.ts` / `cacheUtils.ts` | Cache paths, keys and file name sanitising |
| `workspaceFs.ts` | Exception-based `workspace.fs` calls as explicit results |
| `errors.ts` | Error types; deliberately free of any `vscode` import |
| `previewHtml.ts` | Loading / error placeholder webview |

DuckDB is started once per activation and reused, because opening it and
resolving `read_stat` costs hundreds of milliseconds. Conversions write to a
temporary file and rename it into place, so a cancelled or failed run cannot
leave a partial file that a later run would treat as a cache hit. Cancelling
interrupts the running `COPY` rather than waiting for it to finish.

## Packaging

`vsce package` runs `vscode:prepublish`, which compiles TypeScript to `out/`
(for smoke tests) and bundles `src/extension.ts` to `dist/extension.js` via
esbuild. `vscode`, `@duckdb/*`, and `@posit-dev/positron` stay external so
native bindings and host APIs remain real modules.

```sh
npx @vscode/vsce package
```

The VSIX must include `node_modules/@duckdb` and `node_modules/@posit-dev`; CDX needs those runtime dependencies after installation.

Packaging only ships the binding for the platform it runs on. Package on
each platform you intend to support.

CI (`.github/workflows/ci.yml`) runs typecheck/lint/unit tests, a real DuckDB
smoke conversion of `testdata/adsl.sas7bdat`, and `vsce package` on
macOS and Ubuntu.

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

That first run may need network access. If install fails, CDX reports a
clear error asking you to check connectivity instead of a raw DuckDB HTTP message.

Converted Parquet files are cached under
the extension global storage as `parquet/<source-path-hash>/<FriendlyName>.parquet`
with a `source-meta.json` sidecar. Opening the Parquet through `vscode.open`
lets Positron route `*.parquet` into its built-in Data Explorer.

Use `CDX: Open Cache Folder` to reveal that directory in Finder/Explorer.
`CDX: Clear CDX Cache` asks for confirmation before deleting.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `cdx.autoOpen` | `true` | Convert and open when you open a `.sas7bdat` / `.xpt`. Off shows an **Open Dataset** button instead. |
| `cdx.cacheMaxMb` | `0` (unlimited) | Soft cap on cache size. After a convert, oldest cache folders are removed until the cache fits. |

## Install size

The extension is ~100 MB installed because it bundles DuckDB’s native
engine (`libduckdb.dylib` on macOS). The TypeScript entrypoint is only a
few dozen kilobytes; almost all of the size is the embedded database
required to run `read_stat` offline after the first extension install.

## Untrusted workspaces

CDX declares `untrustedWorkspaces: unsupported`. It loads a native library
and reads clinical files from disk, so it does not activate in untrusted
workspaces.
