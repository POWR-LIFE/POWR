import { requireOptionalNativeModule } from 'expo';

/** OS power policy for this app on Android. Every field null = the OS couldn't say. */
export type BatteryState = {
  /** True when the user granted "Unrestricted" battery use (our onboarding ask). */
  ignoringBatteryOptimizations: boolean | null;
  /** True when the user set battery use to "Restricted" — background work is cut off. */
  backgroundRestricted: boolean | null;
  /** UsageStatsManager standby bucket: 5 exempted, 10 active, 20 working set, 30 frequent, 40 rare, 45 restricted. */
  standbyBucket: number | null;
  powerSaveMode: boolean | null;
};

type NativeModule = { getState(): BatteryState | null };

// Optional on purpose: the module is Android-only, so iOS and web resolve null.
const native = requireOptionalNativeModule<NativeModule>('PowrBatteryState');

/** Current battery policy, or null on iOS / web / when the OS can't answer. Never throws. */
export function getBatteryState(): BatteryState | null {
  try {
    return native?.getState() ?? null;
  } catch {
    return null;
  }
}
