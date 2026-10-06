// Metro config for the pnpm monorepo (docs/07 §10). Aliases come from tsconfig paths
// (experiments.tsconfigPaths in app.config.ts), so no babel module resolver is used.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;

// Bundle size (24 S7-01, docs/perf-s7.md): react-native-purchases imports its browser-mode engine
// (~1 MB minified) unconditionally, but only Expo Go and web use it. Native bundles get a stub.
const BROWSER_ONLY_MODULES = {
  '@revenuecat/purchases-js-hybrid-mappings': path.resolve(
    projectRoot,
    'metro/revenuecat-browser-mode-stub.js',
  ),
};
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const stub = platform !== 'web' ? BROWSER_ONLY_MODULES[moduleName] : undefined;
  if (stub) return { type: 'sourceFile', filePath: stub };
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
