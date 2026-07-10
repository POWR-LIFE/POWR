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
