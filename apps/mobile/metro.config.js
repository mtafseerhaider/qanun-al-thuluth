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

// Bundle size (24 S7-01, docs/perf-s7.md): dependencies that import web-only or unused code at module
// load (the RevenueCat browser engine, Sentry replay and web feedback) resolve to stubs in native
// bundles. The list and the reasons are in metro/native-stubs.js.
const { nativeStubFor } = require('./metro/native-stubs');

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const stub = nativeStubFor(moduleName, platform);
  if (stub) return { type: 'sourceFile', filePath: stub };
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
