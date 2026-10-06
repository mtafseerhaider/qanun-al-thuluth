// Jest config (docs/21-testing-strategy.md §2). Shared preset: @thuluth/config/jest/preset.
const sharedPreset = require('@thuluth/config/jest/preset');

const preset = sharedPreset.default ?? sharedPreset;

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  setupFiles: ['<rootDir>/src/test/setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/test/**'],
};
