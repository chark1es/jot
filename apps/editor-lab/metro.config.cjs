const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['@jot/source', 'require', 'import'];
config.resolver.unstable_conditionsByPlatform = {
  ...config.resolver.unstable_conditionsByPlatform,
  ios: ['@jot/source', 'react-native'],
  android: ['@jot/source', 'react-native'],
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'isomorphic-webcrypto/src/react-native') {
    return {
      filePath: path.resolve(projectRoot, 'metro-shims/expo-webcrypto.cjs'),
      type: 'sourceFile',
    };
  }
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const stem = moduleName.slice(0, -3);
    for (const candidate of [`${stem}.ts`, `${stem}.tsx`, stem]) {
      try {
        return context.resolveRequest(context, candidate, platform);
      } catch {
        // NodeNext emits .js specifiers for .ts sources.
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
