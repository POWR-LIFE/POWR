const { expo } = require('./app.json');

module.exports = {
  expo: {
    ...expo,
    ios: {
      ...expo.ios,
      infoPlist: {
        ...expo.ios?.infoPlist,
        NSHealthShareUsageDescription:
          'POWR reads your steps and workouts to verify your activity and award full points.',
        NSHealthUpdateUsageDescription:
          'POWR needs health access to verify your workouts.',
      },
      entitlements: {
        ...expo.ios?.entitlements,
        'com.apple.developer.healthkit': true,
      },
    },
    android: {
      ...expo.android,
      minSdkVersion: 26,
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
        },
      },
    },
    plugins: [
      ...expo.plugins,
      ['react-native-health-connect'],
    ],
  },
};
