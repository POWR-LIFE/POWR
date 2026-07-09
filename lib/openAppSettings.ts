// ---------------------------------------------------------------------------
// Deep-links into the OS settings screens for POWR's own permissions.
//
// iOS exposes a single per-app settings page (Linking.openSettings), which is
// where Location / Notifications / etc. all live — so there's nothing finer to
// target. Android has no public intent that lands directly on an app's
// *location permission* toggle, so the best we can do is the app's "App Info"
// page (APPLICATION_DETAILS_SETTINGS); the user taps Permissions › Location
// from there. That's one hop closer than the generic settings root and avoids
// dumping the user at the system-wide Location Services list, which doesn't
// show POWR's per-app grant at all.
// ---------------------------------------------------------------------------

import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

/**
 * Opens the most specific settings screen the OS allows for POWR's location
 * permission. On Android this is the app's App-Info page (Permissions ›
 * Location is one tap from there); on iOS it's POWR's app settings page.
 * Always resolves to *some* visible screen. Never throws.
 */
export async function openAppLocationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    // App-Info page. Reading applicationId is a native call, so keep it inside
    // the try alongside the intent launch.
    try {
      const pkg = Application.applicationId;
      if (pkg) {
        await IntentLauncher.startActivityAsync(
          'android.settings.APPLICATION_DETAILS_SETTINGS',
          { data: `package:${pkg}` },
        );
        return;
      }
    } catch {
      // expo-intent-launcher not linked in this binary, or intent unavailable —
      // fall through to the core-RN settings root below.
    }
  }

  // iOS, and the Android fallback: core React Native, present in every build.
  try {
    await Linking.openSettings();
  } catch (err) {
    console.warn('[settings] Could not open app settings:', err);
  }
}
