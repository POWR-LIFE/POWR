/**
 * HealthKit background delivery → the health sync, iOS only.
 *
 * Apple Watch (or any app writing to Apple Health) finishes a workout; iOS
 * wakes POWR, this observer fires, and lib/health/healthSync writes the
 * session and its points within seconds — closed app or not. Before this
 * (2026-10-27) the rows waited for the member to open POWR.
 *
 * How it holds up:
 *   - subscribeToChanges registers an HKObserverQuery; enableBackgroundDelivery
 *     is what lets iOS resume a suspended POWR to fire it. The entitlement
 *     (com.apple.developer.healthkit.background-delivery) shipped in 1.6.0.
 *   - An observer fires once on registration too, so every JS boot — the UI,
 *     a beacon wake, iOS relaunching us for a delivery — runs one pass. The
 *     45 s gap inside syncHealthOnStoreChange keeps that to one.
 *   - After iOS terminates the app (reboot, memory), the queries are gone until
 *     the next launch of any kind. Re-registering them before JS is up needs
 *     the library's BackgroundDeliveryManager in AppDelegate: plugins/
 *     withHealthKitBackgroundObservers.js, for the next native build.
 *   - Armed from lib/headlessTasks at module scope (deferred a tick, inside
 *     try/catch, so a native hiccup can't break a boot) and again from the
 *     foreground hook once the store is authorised, which also reads the
 *     health_bg_delivery switch: off = registrations cleared, nothing armed.
 *
 * Two types only. Workouts are the points; sleep is last night's row. Steps
 * are deliberately not here: they change every few seconds all day and ride
 * the beacon wake instead (lib/health/walkingSync).
 */

import { Platform } from 'react-native';

import { hydrateBgDelivery, refreshBgDelivery } from '@/lib/health/bgDelivery';
import { syncHealthOnStoreChange } from '@/lib/health/healthSync';

const OBSERVED = ['HKWorkoutTypeIdentifier', 'HKCategoryTypeIdentifierSleepAnalysis'] as const;

type HK = typeof import('@kingstinct/react-native-healthkit');
function getHK(): HK {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@kingstinct/react-native-healthkit') as HK;
}

let subscriptions: { remove: () => boolean }[] = [];
let armed = false;
let arming: Promise<void> | null = null;

async function arm(opts: { refreshSwitch: boolean }): Promise<void> {
    if (Platform.OS !== 'ios') return;
    const on = opts.refreshSwitch ? await refreshBgDelivery() : await hydrateBgDelivery();
    if (!on) {
        await disarmHealthKitDelivery();
        return;
    }
    if (armed) return;
    const HK = getHK();
    if (!HK.isHealthDataAvailable()) return;
    for (const type of OBSERVED) {
        subscriptions.push(HK.subscribeToChanges(type, args => {
            if (args.errorMessage) {
                console.warn('[HealthKitObserver]', type, args.errorMessage);
                return;
            }
            syncHealthOnStoreChange();
        }));
        // UpdateFrequency.immediate; a type the member hasn't shared resolves
        // false and is simply never delivered.
        await HK.enableBackgroundDelivery(type, 1).catch(() => false);
    }
    armed = true;
    console.log('[HealthKitObserver] armed for', OBSERVED.join(', '));
}

/**
 * Registers the observers and asks iOS for immediate delivery. Idempotent;
 * never throws. `refreshSwitch` reads the server's switch first (foreground
 * only — a headless boot takes the cached value).
 */
export function armHealthKitDelivery(opts: { refreshSwitch: boolean } = { refreshSwitch: false }): Promise<void> {
    if (arming) return arming;
    arming = arm(opts)
        .catch(err => { console.warn('[HealthKitObserver] arm failed (non-fatal):', err); })
        .finally(() => { arming = null; });
    return arming;
}

/** Drops the observers and tells iOS to stop waking us. Never throws. */
export async function disarmHealthKitDelivery(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    try {
        for (const s of subscriptions) s.remove();
        subscriptions = [];
        if (armed) await getHK().disableAllBackgroundDelivery().catch(() => false);
    } catch (err) {
        console.warn('[HealthKitObserver] disarm failed (non-fatal):', err);
    } finally {
        armed = false;
    }
}

/** Whether the observers are registered in this JS context. */
export function isHealthKitDeliveryArmed(): boolean {
    return armed;
}

// Module scope, so a headless boot arms too (see lib/headlessTasks). Deferred
// a tick: Nitro must be up before the first call, and nothing at import time
// may throw.
if (Platform.OS === 'ios') {
    setTimeout(() => { void armHealthKitDelivery(); }, 0);
}
