// babel-preset-expo with NativeWind's JSX import source; nativewind/babel adds the worklets plugin last.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
