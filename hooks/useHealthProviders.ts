import { useCallback, useEffect, useState } from 'react';

import {
    ALL_PROVIDER_META,
    getNativeProviderId,
    getProvider,
    visibleProviders,
    type HealthProviderId,
    type HealthProviderMeta,
} from '@/lib/health/providers';
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

    const writeProfile = useCallback(async (patch: Partial<ProfileRow>) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('profiles').update(patch).eq('id', user.id);
    }, []);

    const connect = useCallback(async (id: HealthProviderId): Promise<boolean> => {
        setBusyId(id);
        try {
            const provider = getProvider(id);
            const ok = await provider.connect();
            if (!ok) return false;
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
            return true;
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
