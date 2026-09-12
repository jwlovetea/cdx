import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `eslint.config.mjs` is tooling rather than source: TypeScript cannot add it
    // to a project without `allowJs`, so it is not type-checked or linted.
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '.vscode-test/**',
      '**/*.vsix',
      'eslint.config.mjs',
      'esbuild.js',
      'scripts/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      },
      parserOptions: {
        // The test config is the one that covers every file in the repo,
        // including tests and the tooling configs at the root.
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Cancellation and DuckDB failures are reported to the user, not swallowed,
      // but an empty catch is the clearest way to express "cleanup is best effort".
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Type-aware promise handling: a floating promise is almost always a bug.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // Consistent, self-documenting types.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' }
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-explicit-any': 'error',

      // Naming: constant references are UPPER_SNAKE, everything else camelCase.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'variableLike', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        // A leading underscore marks a parameter that is deliberately unused,
        // such as the resolver of a promise a test only ever rejects.
        {
          selector: 'parameter',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow'
        }
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error'
    }
  },
  {
    // Tests deliberately exercise invalid input and unknown thrown values.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Fakes implement promise-returning interfaces even when there is
      // nothing inside them to await.
      '@typescript-eslint/require-await': 'off'
    }
  },
  {
    // The stub mirrors the VS Code API, whose methods are all promise-returning
    // even when the in-memory implementation has nothing to await.
    files: ['src/test/__mocks__/**'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off'
    }
  }
);
