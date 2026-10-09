import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { iosRequestVitalsAccess, iosVitalsAccessUndecided } from '@/hooks/useHealthData';
import { syncDailyVitals } from '@/lib/health/dailyVitals';
import { forgetMaxHr } from '@/lib/health/maxHeartRate';

/**
 * The Body tab's one-tap ask for HealthKit's HRV and birth date.
 *
 * Users who connected Apple Health before those types existed in the app have
 * never been asked for them, and the launch-time restore deliberately never
 * asks (it would raise the Health sheet with no context — see
 * HK_VITALS_PERMISSIONS in hooks/useHealthData). The Body tab is where HRV
 * shows, so it asks there, once: HealthKit reports the request as decided
 * after the sheet whatever the answer, and the row goes away.
 *
 * iOS only. Health Connect can't grant HRV until a native build declares
 * READ_HEART_RATE_VARIABILITY; until then the Android connect flow asks.
 */
export function useHrvAccessPrompt(enabled: boolean, onGranted?: () => void): {
    show: boolean;
    busy: boolean;
    allow: () => Promise<void>;
} {
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!enabled || Platform.OS !== 'ios') {
            setShow(false);
            return;
        }
        let live = true;
        iosVitalsAccessUndecided().then(undecided => { if (live) setShow(undecided); });
        return () => { live = false; };
    }, [enabled]);

    const allow = useCallback(async () => {
        setBusy(true);
        try {
            await iosRequestVitalsAccess();
            setShow(false);
            // A birth date may be readable now — zones re-derive on the next sync.
            forgetMaxHr();
            // Pull the week's HRV straight away rather than at the next hourly pass.
            const written = await syncDailyVitals({ force: true });
            if (written > 0) onGranted?.();
        } finally {
            setBusy(false);
        }
    }, [onGranted]);

    return { show, busy, allow };
}
