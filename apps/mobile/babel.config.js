// babel-preset-expo with NativeWind's JSX import source; nativewind/babel adds the worklets plugin last.
//
// Cold start (24 S7-01, apps/mobile/docs/perf-s7.md): feature barrels re-export their screens, and
// bootstrap imports those barrels for outbox handlers, so every screen module used to be evaluated
// before the first render. Babel's CommonJS transform with `lazyImports` turns the barrels'
// `./screens/*` re-exports into getters that require the screen on first access. Navigators pass
// screens through `getComponent`, so a screen's module runs when the screen is first shown.
// Babel (not Metro's ESM path) must do the module transform for `lazyImports` to apply, hence
// `disableImportExportTransform: false`. Only screen modules are lazy: they have no import-time side
// effects, unlike outbox registration, stores and SDK adapters.
/** @param {string} specifier */
const isLazyScreenImport = (specifier) => specifier.startsWith('./screens/');

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
          disableImportExportTransform: false,
          lazyImports: isLazyScreenImport,
        },
      ],
      'nativewind/babel',
    ],
  };
};
