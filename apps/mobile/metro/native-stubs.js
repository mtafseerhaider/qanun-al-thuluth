// Packages that native (iOS and Android) bundles resolve to a local stub (apps/mobile/docs/perf-s7.md).
// Each is imported unconditionally by a dependency but only used on web or in a feature Thuluth does
// not enable. Web bundles keep the real package. Check this list on every upgrade of the importing
// package; src/lib/__tests__/native-stubs.test.ts fails when a stub misses a name that is imported.
/* global module, require, __dirname */
'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS loaded by metro.config.js
const path = require('path');

const sentryExtras = path.resolve(__dirname, 'sentry-browser-extras-stub.js');

const NATIVE_STUBS = {
  // react-native-purchases: the purchases-js engine for browser mode (Expo Go, web). ~1 MB.
  '@revenuecat/purchases-js-hybrid-mappings': path.resolve(
    __dirname,
    'revenuecat-browser-mode-stub.js',
  ),
  // @sentry/browser (via @sentry/react-native): session replay and the web feedback widget. ~185 KB.
  '@sentry-internal/replay': sentryExtras,
  '@sentry-internal/replay-canvas': sentryExtras,
  '@sentry-internal/feedback': sentryExtras,
};

/** The stub file for `moduleName` on `platform`, or undefined to resolve normally. */
function nativeStubFor(moduleName, platform) {
  if (platform === 'web') return undefined;
  return NATIVE_STUBS[moduleName];
}

module.exports = { NATIVE_STUBS, nativeStubFor };
