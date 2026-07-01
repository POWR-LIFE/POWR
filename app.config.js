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
        // 'location' is required for the gym-approach high-accuracy stream
        // (startLocationUpdatesAsync) to keep delivering in the background — region
        // monitoring alone doesn't need it, but the approach stream does. 'fetch'
        // (boot re-arm) + 'remote-notification' (push) preserved.
        UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
      },
      entitlements: {
        ...expo.ios?.entitlements,
        'com.apple.developer.healthkit': true,
        'com.apple.developer.applesignin': ['Default'],
      },
    },
    android: {
      ...expo.android,
      googleServicesFile: './google-services.json',
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
        },
      },
    },
    extra: {
      ...expo.extra,
      eas: {
        projectId: '7f4fe661-8919-4790-bd66-209373f958de',
      },
    },
    plugins: [
      './withFirebaseMessagingManifestFix.js',
      ...expo.plugins,
      './withGoogleUtilitiesModularHeaders.js',
      '@react-native-firebase/app',
      'expo-apple-authentication',
      ['react-native-health-connect'],
      'expo-secure-store',
      [
        'expo-image-picker',
        {
          photosPermission: 'POWR needs access to your photo library so you can set a profile picture.',
          cameraPermission: 'POWR needs access to your camera so you can take a profile photo.',
        },
      ],
    ],
  },
};
