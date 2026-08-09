import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import type { PermissionFixKind } from '@/components/PermissionFixScreen';
import {
    deriveSetupVerdict,
    dismissBackgroundHealthToday,
    isBackgroundHealthDismissedToday,
    readBackgroundHealth,
} from '@/lib/backgroundHealth';

/**
 * Surfaces the verdict the device's own background context reached about itself
 * (see lib/backgroundHealth.ts), and exposes the fix for it.
 *
 * Deliberately the same shape as useHealthGap: check on mount, re-check on
 * foreground, render nothing when there is nothing to say. It is NOT a fourth
 * self-gating modal — Home already mounts three (NotificationPrimeSheet,
 * LocationPrimeSheet, HealthPrimeSheet) which have to yield to one another in
 * sequence, so a user with two gaps waits weeks to hear about the second. This
 * one is an inline card that competes with nothing.
 */
export function useSetupHealth() {
    const [verdict, setVerdict] = useState<PermissionFixKind | null>(null);

    const check = useCallback(async () => {
        // Native-only: expo-location's background permission has no meaning on web.
        if (Platform.OS === 'web') { setVerdict(null); return; }

        if (await isBackgroundHealthDismissedToday()) { setVerdict(null); return; }

        const health = await readBackgroundHealth();
        // Short-circuit before touching the permission API. Nothing has been
        // recorded, or what was recorded is healthy — either way the probe below
        // cannot change the answer, and it is the more expensive question.
        if (!health || health.outcome !== 'no_permission') { setVerdict(null); return; }

        const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
        setVerdict(deriveSetupVerdict({
            health,
            // null (a failed read) is NOT "denied" — it must not manufacture a
            // verdict, and deriveSetupVerdict only suppresses on an explicit true.
            backgroundGrantedNow: bg ? bg.status === 'granted' : null,
        }));
    }, []);

    useEffect(() => { check(); }, [check]);

    // The user leaves to change a system setting and comes back; re-reading here
    // is what makes the card disappear on return without waiting for a sweep.
    useEffect(() => {
        const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
        return () => sub.remove();
    }, [check]);

    /**
     * Called when the fix screen closes — whether or not anything was fixed.
     *
     * ⚠ MUST NOT CLEAR THE RECORD. It used to, on the theory that the next sweep
     * would re-record it within minutes. There is no next sweep: gym-visit-beacon
     * ships FLEET_INTERVAL_MIN = 0, so real users get no periodic wake at all.
     * Clearing on a plain back-out (the chevron, "Not now", swipe-down — none of
     * which grant anything) therefore permanently disarmed the one surface that
     * tells the user they are earning nothing, with no path back short of a
     * reboot re-arm.
     *
     * Re-deriving is sufficient AND correct for both cases: if the permission
     * was actually granted, the live probe returns true and deriveSetupVerdict
     * suppresses on `backgroundGrantedNow`; if it was not, the record survives
     * and the banner rightly stays.
     */
    const resolved = useCallback(async () => { await check(); }, [check]);

    const dismiss = useCallback(async () => {
        await dismissBackgroundHealthToday();
        setVerdict(null);
    }, []);

    return { verdict, hasGap: verdict !== null, resolved, dismiss, recheck: check };
}
