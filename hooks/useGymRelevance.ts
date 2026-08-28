import { useEffect, useState } from 'react';
import { useAuthOptional } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
    RELEVANCE_WINDOW_MS,
    isGymRelevant,
    type SessionLike,
} from '@/supabase/functions/_shared/activityRelevance';

// Per-user memo so every gym-framed surface (Home banner, prime sheet, fix
// screen, permissions help) shares ONE session lookup per app session.
const cache = new Map<string, { rows: SessionLike[]; at: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Is the gym relevant to this user — declared in their activity picks, or
 * actually produced as sessions in the last 21 days? Drives copy that used to
 * assume everyone is a gym-goer ("your gym check-ins are paused"). Defaults to
 * the DECLARED answer while the session lookup is in flight, so a real gym
 * user never flashes the generic wording.
 */
export function useGymRelevance(): boolean {
    // Optional: PermissionFixScreen & co. render outside AuthProvider in tests
    // and on some onboarding paths — no user simply means "assume gym".
    const user = useAuthOptional()?.user;
    const uid = user?.id ?? null;
    const declared = user?.user_metadata?.activity_preferences;
    const [rows, setRows] = useState<SessionLike[]>(() => (uid && cache.get(uid)?.rows) || []);

    useEffect(() => {
        if (!uid) return;
        const hit = cache.get(uid);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) { setRows(hit.rows); return; }
        let cancelled = false;
        supabase
            .from('activity_sessions')
            .select('type, started_at, verification')
            .eq('user_id', uid)
            .eq('type', 'gym')
            .gte('started_at', new Date(Date.now() - RELEVANCE_WINDOW_MS).toISOString())
            .limit(1)
            .then(({ data }) => {
                if (cancelled) return;
                const next = (data ?? []) as SessionLike[];
                cache.set(uid, { rows: next, at: Date.now() });
                setRows(next);
            }, () => { /* declared-only answer is fine */ });
        return () => { cancelled = true; };
    }, [uid]);

    return isGymRelevant(declared, rows, Date.now());
}
