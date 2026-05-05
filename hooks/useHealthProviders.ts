import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
    ALL_PROVIDER_META,
    getNativeProviderId,
    getProvider,
    visibleProviders,
    type HealthProviderId,
    type HealthProviderMeta,
} from '@/lib/health/providers';
import type { ConnectResult } from '@/lib/health/providers/types';
import { supabase } from '@/lib/supabase';

export type ProviderConnection = {
    connected_at?: string;
    last_sync_at?: string;
    scopes?: string[];
};

export type ProviderRow = {
    meta: HealthProviderMeta;
    connection: ProviderConnection | null;
    isActive: boolean;
};

type ProfileRow = {
    active_health_provider: HealthProviderId | null;
    health_provider_connections: Record<string, ProviderConnection> | null;
};

/**
 * Reads/writes the user's health-provider state on `profiles` and exposes
 * connect / disconnect / setActive actions. This is the single source of
 * truth for the settings UI and onboarding picker.
 */
export function useHealthProviders() {
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<HealthProviderId | null>(null);
    const [activeId, setActiveId] = useState<HealthProviderId | null>(null);
    const [connections, setConnections] = useState<Record<string, ProviderConnection>>({});

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data } = await supabase
                .from('profiles')
                .select('active_health_provider, health_provider_connections')
                .eq('id', user.id)
                .single<ProfileRow>();
            setActiveId(data?.active_health_provider ?? null);
            setConnections(data?.health_provider_connections ?? {});
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Re-fetch when the app returns to the foreground. The OAuth callback writes
    // to the DB after the browser closes, so we do an immediate refresh plus a
    // delayed one to catch the race window between 'active' and the DB write.
    // Also auto-connect the native provider if permissions were granted externally
    // (e.g. the user granted Health Connect access in system settings).
    useEffect(() => {
        const nativeId = getNativeProviderId();
        const sub = AppState.addEventListener('change', state => {
            if (state !== 'active') return;
            refresh();
            setTimeout(refresh, 2000);

            if (!nativeId) return;
            (async () => {
                const provider = getProvider(nativeId);
                const isNowGranted = await provider.isConnected();
                if (!isNowGranted) return;
                // Re-read DB to avoid stale closure — only write if not already there.
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data } = await supabase
                    .from('profiles')
                    .select('active_health_provider, health_provider_connections')
                    .eq('id', user.id)
                    .single<ProfileRow>();
                const conns = data?.health_provider_connections ?? {};
                if (conns[nativeId]) return;
                const next = { ...conns, [nativeId]: { connected_at: new Date().toISOString() } };
                const nextActive = data?.active_health_provider ?? nativeId;
                await supabase.from('profiles')
                    .update({ health_provider_connections: next, active_health_provider: nextActive })
                    .eq('id', user.id);
                await refresh();
            })();
        });
        return () => sub.remove();
    }, [refresh]);

    const writeProfile = useCallback(async (patch: Partial<ProfileRow>) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('profiles').update(patch).eq('id', user.id);
    }, []);

    const connect = useCallback(async (id: HealthProviderId): Promise<ConnectResult> => {
        setBusyId(id);
        try {
            const provider = getProvider(id);
            const result = await provider.connect();
            if (result !== 'connected') {
                // 'pending' → an OAuth callback route will write the profile and
                // a subsequent refresh() will pick it up. 'failed' → nothing to
                // write. Either way we don't touch the DB here.
                return result;
            }
            const next: Record<string, ProviderConnection> = {
                ...connections,
                [id]: { ...(connections[id] ?? {}), connected_at: new Date().toISOString() },
            };
            // First connect auto-promotes to active if nothing else is active.
            const nextActive = activeId ?? id;
            await writeProfile({
                health_provider_connections: next,
                active_health_provider: nextActive,
            });
            setConnections(next);
            setActiveId(nextActive);
            return 'connected';
        } finally {
            setBusyId(null);
        }
    }, [activeId, connections, writeProfile]);

    const disconnect = useCallback(async (id: HealthProviderId) => {
        setBusyId(id);
        try {
            await getProvider(id).disconnect();
            const next = { ...connections };
            delete next[id];
            // If we removed the active one, fall back to any other connected
            // provider, otherwise null.
            const fallback = activeId === id
                ? (Object.keys(next)[0] as HealthProviderId | undefined) ?? null
                : activeId;
            await writeProfile({
                health_provider_connections: next,
                active_health_provider: fallback,
            });
            setConnections(next);
            setActiveId(fallback);
        } finally {
            setBusyId(null);
        }
    }, [activeId, connections, writeProfile]);

    const setActive = useCallback(async (id: HealthProviderId) => {
        if (id === activeId) return;
        setBusyId(id);
        try {
            await writeProfile({ active_health_provider: id });
            setActiveId(id);
        } finally {
            setBusyId(null);
        }
    }, [activeId, writeProfile]);

    const rows: ProviderRow[] = visibleProviders().map(meta => ({
        meta,
        connection: connections[meta.id] ?? null,
        isActive: activeId === meta.id,
    }));

    return {
        loading,
        busyId,
        activeId,
        rows,
        nativeProviderId: getNativeProviderId(),
        allMeta: ALL_PROVIDER_META,
        connect,
        disconnect,
        setActive,
        refresh,
    };
}
