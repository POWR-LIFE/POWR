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
import { AppState, Linking, Platform } from 'react-native';

const PROMPTED_KEY = '@powr/battery_opt_prompted';

/**
 * Fires an intent and reports whether anything actually came up on screen.
 *
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is silently dropped by Android when the
 * app is *already* exempt, and some OEMs drop it outright — startActivityAsync
 * resolves happily either way, so its return value can't be trusted. There's no
 * API to query the exemption, but there is an observable proxy: a real dialog or
 * settings page puts POWR in the background. If we never left the foreground,
 * nothing was shown and the caller must try a different screen — otherwise the
 * button looks dead to the user.
 */
async function launchAndConfirm(action: string, pkg: string): Promise<boolean> {
  let backgrounded = false;
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') backgrounded = true;
  });
  try {
    await IntentLauncher.startActivityAsync(action, { data: `package:${pkg}` });
    // AppState events can land just after the promise settles; give them a beat.
    await new Promise((r) => setTimeout(r, 350));
    return backgrounded;
  } catch {
    // Intent unavailable, permission missing from this binary, or OEM refusal.
    return false;
  } finally {
    sub.remove();
  }
}

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

  // Reading applicationId is itself a native call, so guard it. Note this is the
  // *running* package — under Expo Go that's host.exp.exponent, so in dev the
  // exemption applies to Expo Go (which is the process running the location
  // task anyway); in a real build it's POWR.
  let pkg: string | null = null;
  try {
    pkg = Application.applicationId;
  } catch {
    // expo-application not linked in this binary.
  }

  if (pkg) {
    // 1. Direct "Allow POWR to ignore battery optimization?" dialog. Requires the
    //    REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission + the expo-intent-launcher
    //    native module — both only present after a native rebuild. Silently does
    //    nothing when already exempt, hence the launchAndConfirm check.
    if (await launchAndConfirm('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', pkg)) {
      return true;
    }

    // 2. POWR's own App-info page (Battery → Unrestricted lives here). Always a
    //    visible, actionable screen, so the button never feels dead when step 1
    //    no-ops or isn't available in this binary.
    if (await launchAndConfirm('android.settings.APPLICATION_DETAILS_SETTINGS', pkg)) {
      return true;
    }
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
