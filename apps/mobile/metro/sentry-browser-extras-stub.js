// Native builds only (metro.config.js, metro/native-stubs.js, apps/mobile/docs/perf-s7.md): replaces
// @sentry-internal/replay, @sentry-internal/replay-canvas and @sentry-internal/feedback (~185 KB
// minified). @sentry/browser re-exports them, and @sentry/react-native pulls in @sentry/browser, but
// Thuluth uses neither session replay nor the user feedback widget: lib/sentry/init.ts adds only
// the navigation integration. React Native's own feedback widget (@sentry/react-native
// dist/js/feedback, used by Sentry.wrap) is not affected. If replay or feedback is ever enabled,
// remove the stub first; until then every entry point fails loudly instead of doing nothing.
/* global module */
'use strict';

const message =
  '[thuluth] Sentry session replay and browser feedback are not bundled in native builds. ' +
  'Remove the stub in apps/mobile/metro/native-stubs.js before enabling them.';

function unavailable() {
  throw new Error(message);
}

module.exports = {
  // @sentry-internal/replay
  replayIntegration: unavailable,
  getReplay: () => undefined,
  // @sentry-internal/replay-canvas
  replayCanvasIntegration: unavailable,
  // @sentry-internal/feedback
  buildFeedbackIntegration: unavailable,
  feedbackModalIntegration: unavailable,
  feedbackScreenshotIntegration: unavailable,
  getFeedback: () => undefined,
  sendFeedback: unavailable,
};
