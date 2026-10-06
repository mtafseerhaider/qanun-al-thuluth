import i18next from 'eslint-plugin-i18next';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import base from './base.js';

/**
 * Flat config for the Expo app (docs/07-react-native-folder-structure.md §8.2, 08 §10.3, 00 §4.3).
 * Spread into apps/mobile/eslint.config.js after setting languageOptions.parserOptions.
 */

const SDK_PACKAGES = [
  '@supabase/supabase-js',
  'react-native-purchases',
  'react-native-onesignal',
  '@sentry/react-native',
  'react-native-mmkv',
  'expo-secure-store',
  '@react-native-google-signin/google-signin',
  'expo-apple-authentication',
];

const BASE_PATTERNS = [
  {
    group: ['@/features/*/*'],
    message: 'Import features through their public index.ts (07 §8.2 rule 1).',
  },
  {
    group: ['@ai-core', '@ai-core/*', '@thuluth/ai-core', '@thuluth/ai-core/*'],
    message: 'AI providers are server-only (00 §3).',
  },
  { group: ['../../*'], message: 'Use an alias instead of deep relative paths.' },
];

const SDK_PATHS = SDK_PACKAGES.map((name) => ({
  name,
  message: 'Third-party SDKs may be imported only from src/lib/** and src/app/** (07 §8.2 rule 4).',
}));

const restrict = ({ patterns = [], paths = [] } = {}) => [
  'error',
  { patterns: [...BASE_PATTERNS, ...patterns], paths: [...paths] },
];

/** Physical direction utilities break RTL (08 §10.3). Use ps/pe/ms/me/start/end/text-start/text-end. */
const PHYSICAL_CLASS = String.raw`/(^|\s|:)-?(pl|pr|ml|mr|left|right|text-left|text-right|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|border-l|border-r|scroll-ml|scroll-mr|scroll-pl|scroll-pr)(-|\s|$)/`;
const RTL_SYNTAX = [
  {
    selector: `JSXAttribute[name.name=/^(className|contentContainerClassName)$/] Literal[value=${PHYSICAL_CLASS}]`,
    message:
      'Use logical utilities (ps-/pe-/ms-/me-/start-/end-/text-start/text-end) instead of left/right (08 §10.3).',
  },
  {
    selector: `JSXAttribute[name.name=/^(className|contentContainerClassName)$/] TemplateElement[value.raw=${PHYSICAL_CLASS}]`,
    message:
      'Use logical utilities (ps-/pe-/ms-/me-/start-/end-/text-start/text-end) instead of left/right (08 §10.3).',
  },
];
const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message:
    'Named exports only; default exports are allowed in App.tsx, config files and *.stories.tsx (07 §7).',
};

export default [
  ...base,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks, i18next },
    languageOptions: {
      globals: { ...globals.browser, __DEV__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
      'no-restricted-imports': restrict({ paths: SDK_PATHS }),
      'no-restricted-syntax': ['error', ...RTL_SYNTAX, NO_DEFAULT_EXPORT],
    },
  },
  {
    // SDK adapters and the bootstrap/provider layer may import third-party SDKs.
    files: ['src/lib/**', 'src/app/**'],
    rules: { 'no-restricted-imports': restrict() },
  },
  {
    // lib/* never imports from features/* or navigation/* (rule 3).
    files: ['src/lib/**'],
    rules: {
      'no-restricted-imports': restrict({
        patterns: [
          {
            group: ['@/features', '@/features/*', '@/navigation', '@/navigation/*'],
            message: 'lib/* must not depend on features or navigation (07 §8.2 rule 3).',
          },
        ],
      }),
    },
  },
  {
    // components/ui may import only @/theme, @/hooks and React Native libraries (rule 2).
    files: ['src/components/ui/**'],
    rules: {
      'no-restricted-imports': restrict({
        paths: SDK_PATHS,
        patterns: [
          {
            group: [
              '@/features',
              '@/features/*',
              '@/lib/supabase/*',
              '@/stores',
              '@/stores/*',
              '@/navigation/*',
            ],
            message: 'UI primitives must stay data-free (07 §8.2 rule 2).',
          },
        ],
      }),
    },
  },
  {
    // Default exports are allowed for App.tsx, config files and stories.
    files: ['**/App.tsx', '**/*.config.{js,ts}', '**/*.stories.tsx', '**/*.d.ts', 'index.ts'],
    rules: { 'no-restricted-syntax': ['error', ...RTL_SYNTAX] },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.jest } },
    rules: { 'i18next/no-literal-string': 'off' },
  },
];
