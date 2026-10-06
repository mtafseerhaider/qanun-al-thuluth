import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared flat config for every TypeScript workspace. */
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../../*'], message: 'Use an alias instead of deep relative paths.' }] },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
