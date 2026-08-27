import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

// Google provider everywhere except iOS Expo Go, where the Google Maps native
// module doesn't exist and PROVIDER_GOOGLE throws the moment the map mounts.
// Falling back to Apple Maps there keeps Discover usable in the hot-reload loop.
export const MAP_PROVIDER =
  Platform.OS === 'ios' && Constants.appOwnership === 'expo'
    ? undefined
    : PROVIDER_GOOGLE;

// Key for the Directions web service (walking routes on Discover). Kept
// separate from the per-platform Maps SDK keys: Google rejects app-restricted
// keys on web-service APIs, so this one is application-unrestricted but
// API-restricted to Directions only, with a daily quota cap in GCP.
export const GOOGLE_DIRECTIONS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_KEY ??
  'AIzaSyCB8XePErViq9V4UodDDu49bZUPFaSp678';
