const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Enable .web.tsx / .web.ts platform-specific extensions on web
config.resolver.platforms = ['ios', 'android', 'web'];

// Stub native-only map packages on web
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    if (moduleName === 'react-native-maps' || moduleName === 'react-native-maps-directions') {
      return { filePath: path.resolve(__dirname, 'mocks/react-native-maps.js'), type: 'sourceFile' };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
