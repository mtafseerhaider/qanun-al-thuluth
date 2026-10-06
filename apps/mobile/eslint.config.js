// Flat config (CommonJS; Node 22 loads the ESM shared config through require(esm)).
const reactNative = require('@thuluth/config/eslint/react-native.js').default;

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
      'coverage/**',
      'global.css',
    ],
  },
  ...reactNative,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: __dirname },
    },
  },
];
