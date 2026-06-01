// ---------------------------------------------------------------------------
// Android battery-optimization exemption
//
// A foreground-service location stream (see GeofenceContext) keeps a resident
// process so gym-arrival detection survives the app being closed. But aggressive
// OEM power management can still sleep or kill an app that is NOT exempt from
// battery optimization. This module prompts the user for that exemption.
//
// No-op on iOS, which has no equivalent (region monitoring relaunches a
// terminated app natively).
// ---------------------------------------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

const PROMPTED_KEY = '@powr/battery_opt_prompted';

/**
 * Sends the user to a screen where they can exempt POWR from battery optimization.
 * Tries, in order: the direct system dialog → the battery-optimization list →
 * POWR's own app-settings page. The last step uses core React Native, so it works
 * even before a native rebuild (e.g. when expo-intent-launcher or the
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission isn't in the running binary yet).
 * Returns true if any screen was opened. No-op on iOS.
 */
export async function requestBatteryOptimizationExemption(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  // 1. Direct "Allow POWR to ignore battery optimization?" dialog. Requires the
  //    REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission + the expo-intent-launcher
  //    native module — both only present after a native rebuild. Reading
  //    applicationId is itself a native call, so it stays inside the try.
  try {
    const pkg = Application.applicationId;
    if (pkg) {
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        { data: `package:${pkg}` },
      );
      return true;
    }
  } catch {
    // Permission/module missing from the running binary, or OEM blocks the dialog.
  }

  // 2. The full battery-optimization list (still needs the intent-launcher module).
  try {
    await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    return true;
  } catch {
    // expo-intent-launcher not linked in this build, or intent unavailable.
  }

  // 3. Last resort: POWR's own system settings page (core RN — present in EVERY
  //    build). The user can reach Battery → Unrestricted from there manually.
  try {
    await Linking.openSettings();
    return true;
  } catch (err) {
    console.warn('[battery] Could not open any settings screen:', err);
    return false;
  }
}

/** Whether the one-time exemption prompt has already been shown. */
export async function hasPromptedBatteryOptimization(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPTED_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Marks the one-time exemption prompt as shown so onboarding never re-nags. */
export async function markBatteryOptimizationPrompted(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    /* non-fatal */
  }
}
