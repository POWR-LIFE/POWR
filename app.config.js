const { expo } = require('./app.json');

// Public client-side Maps key (the same value already ships in eas.json and in
// every built app). NEVER default to '' here: an empty key makes `expo prebuild`
// silently skip the iOS GMSServices init + google-maps pod, which produced the
// Discover-map crash in TestFlight 1.4.10 (13).
const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
  'AIzaSyBlWjadfjwrtx62Rmb_b5aAPMM-l2pSgww';

module.exports = {
  expo: {
    ...expo,
    ios: {
      ...expo.ios,
      // Local path is gitignored; EAS builders get it via the
      // GOOGLE_SERVICE_INFO_PLIST file env var (resolves to a builder path).
      googleServicesFile:
        process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist',
      // iOS now renders Google Maps too (matches Android for visual
      // consistency). Reuses the same key as Android — requires the
      // "Maps SDK for iOS" API to be enabled on it in GCP.
      config: {
        ...expo.ios?.config,
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      },
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
          apiKey: GOOGLE_MAPS_API_KEY,
        },
      },
    },
    extra: {
      ...expo.extra,
      eas: {
        projectId: '7f4fe661-8919-4790-bd66-209373f958de',
      },
    },
    updates: {
      url: 'https://u.expo.dev/7f4fe661-8919-4790-bd66-209373f958de',
      // Channel for builds made outside EAS (local Xcode iOS builds); EAS
      // builds override this with the profile's channel at build time.
      // For an App Store archive: POWR_IOS_CHANNEL=production npx expo prebuild -p ios --clean
      requestHeaders: {
        'expo-channel-name': process.env.POWR_IOS_CHANNEL ?? 'preview',
      },
    },
    // Fingerprint = hash of the native project: JS-only changes share a runtime
    // (deliverable OTA), anything touching native modules fences itself off to
    // new binaries automatically. Never publish OTA across a native change.
    runtimeVersion: {
      policy: 'fingerprint',
    },
    plugins: [
      ...expo.plugins,
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
      [
        'expo-media-library',
        {
          photosPermission: 'POWR needs access to your photos to save your share card.',
          savePhotosPermission: 'POWR needs permission to save your share card to your photos.',
          isAccessMediaLocationEnabled: false,
        },
      ],
    ],
  },
};
