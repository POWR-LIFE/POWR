import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { getAppVersion } from '@/lib/device';
import { supabase } from '@/lib/supabase';

// "Is there a newer store build than the one running?" — driven by the
// admin-set system_config keys latest_ios_version / latest_android_version
// (System Config → App Release), bumped by hand when a release goes live on
// its store. Deliberately NOT queried from the stores at runtime: a config row
// is deterministic, can lag a phased rollout on purpose, and can't be broken
// by store-page scraping.
//
// NOTE this whole feature rides the app binary/OTA, so it only nags users the
// current runtime can still reach — it prevents the NEXT version lag. Users
// already stranded on old runtimes are reachable by broadcast push only.

export const IOS_STORE_URL = 'https://apps.apple.com/gb/app/powr/id6766784336';
export const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.powr.life';

// Scheme URLs open the store app directly, skipping a browser bounce.
const IOS_STORE_SCHEME_URL = 'itms-apps://apps.apple.com/gb/app/powr/id6766784336';
const ANDROID_STORE_SCHEME_URL = 'market://details?id=com.powr.life';

const DISMISSED_KEY = '@powr/update_banner_dismissed_for';

/** '1.4.11', '1.4.11 (Expo Go)' → [1, 4, 11]; null when unparseable. */
export function parseVersion(v: string | null | undefined): number[] | null {
  const m = String(v ?? '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Strictly a < b, component-wise. */
export function versionBelow(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** The semver this device is running. Native binary version when available,
 *  else the JS bundle's version (Expo Go / web QA). */
export function runningVersion(): string | null {
  const { appVersion } = getAppVersion();
  const parsed = parseVersion(appVersion);
  if (parsed) return parsed.join('.');
  const fallback = parseVersion(Constants.expoConfig?.version);
  return fallback ? fallback.join('.') : null;
}

/** Store listing for this platform. Web (QA harness) maps to iOS. */
export function getStoreUrl(): string {
  return Platform.OS === 'android' ? ANDROID_STORE_URL : IOS_STORE_URL;
}

/** Open the store listing — store app first, https fallback. */
export async function openStorePage(): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(IOS_STORE_URL);
    return;
  }
  const scheme = Platform.OS === 'android' ? ANDROID_STORE_SCHEME_URL : IOS_STORE_SCHEME_URL;
  try {
    await Linking.openURL(scheme);
  } catch {
    await Linking.openURL(getStoreUrl());
  }
}

export interface UpdateCheck {
  updateAvailable: boolean;
  current: string | null;
  latest: string | null;
}

/** Compare the running version against the admin-published latest for this
 *  platform. Fails closed (no update) on any read/parse problem. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = runningVersion();
  const key = Platform.OS === 'android' ? 'latest_android_version' : 'latest_ios_version';
  try {
    const { data } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    const latestParsed = parseVersion(data?.value);
    const currentParsed = parseVersion(current);
    if (!latestParsed || !currentParsed) return { updateAvailable: false, current, latest: null };
    const latest = latestParsed.join('.');
    return { updateAvailable: versionBelow(currentParsed, latestParsed), current, latest };
  } catch {
    return { updateAvailable: false, current, latest: null };
  }
}

/** Dismissal is per target version: dismissing the 1.4.12 banner keeps it
 *  hidden until 1.4.13 exists, rather than re-nagging every launch. */
export async function isBannerDismissedFor(latest: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DISMISSED_KEY)) === latest;
  } catch {
    return false;
  }
}

export async function dismissBannerFor(latest: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, latest);
  } catch {
    /* banner simply reappears next launch */
  }
}
