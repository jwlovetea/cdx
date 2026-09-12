const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    // Host-provided and native modules must stay as real node_modules.
    external: [
      'vscode',
      // Native DuckDB and its loader must remain real node_modules.
      '@duckdb/node-api',
      '@duckdb/node-bindings',
      // Tiny runtime shim; keep it external so package.json dependencies stay honest.
      '@posit-dev/positron'
    ],
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin]
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[esbuild] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) {
          return;
        }

        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[esbuild] build finished');
    });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
