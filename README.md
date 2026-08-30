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

## Packaging

Build the extension before packaging:

```sh
npm run compile
npx @vscode/vsce package
```

The VSIX must include `node_modules/@duckdb` and `node_modules/@posit-dev`; CDX needs those runtime dependencies after installation.

## Notes

DuckDB installs `read_stat` from the community extension repository the first time it is used:

```sql
INSTALL read_stat FROM community;
LOAD read_stat;
```

That first run may need network access. Converted Parquet files are cached in the extension global storage directory and regenerated when the source path, modified time, or size changes.
