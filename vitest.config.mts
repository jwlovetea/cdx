import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host, so it is
      // aliased to an in-memory stub that lets the cache and converter layers be
      // unit tested.
      vscode: new URL('./src/test/__mocks__/vscode.ts', import.meta.url).pathname
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', '.vscode-test/**'],
    // Each file gets its own module registry, so the stub's in-memory file
    // system cannot leak state between suites.
    isolate: true
  }
});
