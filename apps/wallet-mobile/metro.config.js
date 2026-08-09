const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'crypto') {
    return context.resolveRequest(
      context,
      path.resolve(projectRoot, 'shims/node-crypto.js'),
      platform,
    );
  }
  const origin = context.originModulePath || '';
  const needsNestedNoble = moduleName.startsWith('@noble/')
    && (
      origin.includes(`${path.sep}node_modules${path.sep}viem${path.sep}`)
      || origin.includes(`${path.sep}node_modules${path.sep}ox${path.sep}`)
    );
  if (needsNestedNoble) {
    const resolved = require.resolve(moduleName, {
      paths: [path.dirname(origin)],
    });
    return context.resolveRequest(context, resolved, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.assetExts = [...(config.resolver.assetExts || []), 'wasm'];

module.exports = config;
