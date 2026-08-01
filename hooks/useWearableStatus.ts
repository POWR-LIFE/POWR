import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ALL_PROVIDER_META, type HealthProviderId } from '@/lib/health/providers';
import {
    formatSyncAge,
    hoursSinceUpload,
    wearableFreshness,
    type WearableFreshness,
} from '@/lib/health/wearableStatus';
import { getSessionUser, supabase } from '@/lib/supabase';

export type WearableStatus = {
    /** Provider id ('garmin', 'whoop', …) of the live wearable, else null. */
    providerId: HealthProviderId | null;
    /** Display name ('Garmin'), else null. */
    providerName: string | null;
    /** Provider-reported model ('Forerunner 265') when known. */
    deviceName: string | null;
    freshness: WearableFreshness;
    hoursSinceSync: number | null;
    /** Chip subtitle, e.g. "synced 2h ago". */
    syncLabel: string;
    loading: boolean;
    refresh: () => Promise<void>;
};

const EMPTY: Omit<WearableStatus, 'refresh'> = {
    providerId: null,
    providerName: null,
    deviceName: null,
    freshness: 'none',
    hoursSinceSync: null,
    syncLabel: '',
    loading: false,
};

type ConnRow = {
    provider: string;
    last_upload_at: string | null;
    device_name: string | null;
};

/**
 * Live wearable + how recently it delivered. Reads terra_connections directly
 * (RLS already lets a user read their own rows) rather than
 * profiles.health_provider_connections, because that JSON records only that a
 * connection was made — it carries no delivery history at all, which is exactly
 * the blind spot this hook exists to close.
 *
 * Returns freshness 'none' for the ~95% of users with no wearable, so callers
 * can render nothing without a separate "has a wearable" check.
 */
export function useWearableStatus(): WearableStatus {
    const [state, setState] = useState(EMPTY);

    const refresh = useCallback(async () => {
        // No web gate: unlike the rest of the health stack this reads pure server
        // state (terra_connections), so it works — and stays QA-verifiable — on
        // expo web. The native-API-dependent gap kinds stay web-gated in
        // detectHealthGap.
        setState(s => ({ ...s, loading: true }));
        try {
            const user = await getSessionUser();
            if (!user) { setState(EMPTY); return; }

            // Live connection only. One wearable at a time is enforced by the
            // webhook's handleAuth, but order by freshness anyway so a stray
            // second live row can't win with older data.
            const { data, error } = await supabase
                .from('terra_connections')
                .select('provider, last_upload_at, device_name')
                .eq('user_id', user.id)
                .is('deauthed_at', null)
                .order('last_upload_at', { ascending: false, nullsFirst: false })
                .limit(1);

            // supabase-js resolves rather than throws on query errors, so an
            // explicit check is the only thing standing between a failed fetch
            // and a false "no wearable" (see the partner-portal empty-state bug).
            if (error) { setState(s => ({ ...s, loading: false })); return; }

            const row = (data ?? [])[0] as ConnRow | undefined;
            if (!row) { setState(EMPTY); return; }

            const providerId = row.provider.toLowerCase() as HealthProviderId;
            const meta = ALL_PROVIDER_META.find(m => m.id === providerId);
            const hours = hoursSinceUpload(row.last_upload_at);

            setState({
                providerId,
                providerName: meta?.name ?? row.provider,
                deviceName: row.device_name,
                freshness: wearableFreshness({ connected: true, lastUploadAt: row.last_upload_at }),
                hoursSinceSync: hours,
                syncLabel: formatSyncAge(hours),
                loading: false,
            });
        } catch {
            setState(s => ({ ...s, loading: false }));
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Re-check on foreground: the user may have just reconnected, and the poll
    // cron may have landed data while the app was backgrounded.
    useEffect(() => {
        const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
        return () => sub.remove();
    }, [refresh]);

    return { ...state, refresh };
}
