const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Enable .web.tsx / .web.ts platform-specific extensions on web
config.resolver.platforms = ['ios', 'android', 'web'];

module.exports = withNativeWind(config, { input: "./global.css" });
