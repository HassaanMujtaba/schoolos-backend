import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'prisma/migrations'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      security.configs.recommended,
    ],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- OWASP-aligned hardening (mirrors frontend/eslint.config.js's intent, backend-side) ---
      // A03:2021 Injection — no raw string-built SQL/shell, no eval, no unsafe regex
      'security/detect-object-injection': 'warn', // frequently a false positive on typed code, review each hit
      'security/detect-non-literal-regexp': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      // File-upload/document-storage paths (Phase 3+) are the main legitimate use of dynamic
      // paths in this codebase — keep this as a review trigger, not a blanket ban.
      'security/detect-non-literal-fs-filename': 'warn',

      // A09:2021 Logging failures — catch an accidental `console.log(token)`/`console.log(user)`
      // before it ships; real logging goes through Nest's Logger, which this rule still allows.
      'no-console': 'error',

      // General correctness that doubles as security hygiene — an un-awaited promise in a
      // request handler is a common source of silently-swallowed auth/tenant-check failures.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts', 'prisma/seed.ts'],
    rules: {
      // Test/seed output is meant to be read on a terminal, not shipped — Nest's Logger doesn't
      // run outside a Nest app context anyway (e.g. inside prisma/seed.ts).
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
