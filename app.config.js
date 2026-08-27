const { expo } = require('./app.json');

// Public client-side Maps SDK keys, one per platform, each app-restricted in
// GCP (iOS: bundle id, Android: package + SHA-1s) and API-restricted to its
// platform's Maps SDK. Directions requests use a separate key (lib/mapProvider).
// NEVER default to '' here: an empty key makes `expo prebuild` silently skip
// the iOS GMSServices init + google-maps pod, which produced the Discover-map
// crash in TestFlight 1.4.10 (13).
const GOOGLE_MAPS_IOS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ??
  'AIzaSyCGCWV4OE9yb-gQjH8LNAkYgqm4t2AKq_w';
const GOOGLE_MAPS_ANDROID_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ??
  'AIzaSyCF5McF1ClGMiFu6KVTIVQlt6ExiZX2ark';

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
      // consistency). Requires the "Maps SDK for iOS" API to be enabled
      // on the key's GCP project.
      config: {
        ...expo.ios?.config,
        googleMapsApiKey: GOOGLE_MAPS_IOS_KEY,
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
          apiKey: GOOGLE_MAPS_ANDROID_KEY,
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
      // NOTE: react-native-health-connect is registered in app.json's plugin
      // list. Registering it here as well ran the plugin twice and emitted a
      // duplicate ACTION_SHOW_PERMISSIONS_RATIONALE intent-filter on
      // MainActivity.
      'expo-secure-store',
      // Picks a profile/share-card image and nothing else. On Android 13+ this
      // goes through the system photo picker and requests NO permission, which
      // is what Google Play's Photo and Video Permissions policy requires.
      [
        'expo-image-picker',
        {
          photosPermission: 'POWR needs access to your photo library so you can set a profile picture.',
          cameraPermission: 'POWR needs access to your camera so you can take a profile photo.',
        },
      ],
      // WRITE-ONLY gallery save (lib/saveCard.ts) — re-added 2026-08-24 with
      // Jamie's explicit sign-off after the July Play rejection. The rejection
      // was for READ_MEDIA_IMAGES/_VIDEO, which this plugin injects and
      // android.blockedPermissions (app.json) strips again — verify with the
      // manifest merger before every store submission (see
      // project_play_photo_video_policy_rejection). iOS asks only the add-only
      // Photos permission. We save images; we NEVER read the library.
      [
        'expo-media-library',
        {
          savePhotosPermission: 'POWR saves the images you choose to keep to your Photos.',
          isAccessMediaLocationEnabled: false,
        },
      ],
      // Native crash capture (the .ips-blind-spot complement to lib/crashHandler.ts).
      // organization/project are the Sentry slugs used only for source-map upload
      // at build time; upload is skipped entirely unless SENTRY_AUTH_TOKEN is set
      // in the build env. Keep these literal — env-derived values here would make
      // the fingerprint differ between local and EAS, silently orphaning OTAs.
      [
        '@sentry/react-native/expo',
        {
          url: 'https://sentry.io/',
          organization: 'powr-m9',
          project: 'powr',
        },
      ],
    ],
  },
};
