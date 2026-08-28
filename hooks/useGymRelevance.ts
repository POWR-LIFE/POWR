import { useEffect, useMemo, useState } from 'react';
import { useAuthOptional } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
    RELEVANCE_WINDOW_MS,
    isGymRelevant,
    observedActivityTypes,
    relevantActivities,
    type SessionLike,
} from '@/supabase/functions/_shared/activityRelevance';

// Per-user memo so every personalised surface (Home banner, prime sheet, fix
// screen, permissions help, Together templates) shares ONE session lookup per
// app session.
const cache = new Map<string, { rows: SessionLike[]; at: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Which activities are relevant to this user — declared in their activity
 * picks, or actually produced as sessions in the last 21 days — plus the
 * gym-specific answer every gym-framed surface asks. Defaults to the DECLARED
 * answer while the session lookup is in flight, so a real gym user never
 * flashes the generic wording.
 */
export function useActivityRelevance(): { relevant: string[]; gymRelevant: boolean; declared: unknown } {
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
        // Wrapped: a test double or a half-initialised client must degrade to
        // the declared-only answer, never throw out of an effect.
        try {
        supabase
            .from('activity_sessions')
            .select('type, started_at, verification')
            .eq('user_id', uid)
            .neq('type', 'sleep')
            .gte('started_at', new Date(Date.now() - RELEVANCE_WINDOW_MS).toISOString())
            .order('started_at', { ascending: false })
            .limit(300)
            .then(({ data }) => {
                if (cancelled) return;
                const next = (data ?? []) as SessionLike[];
                cache.set(uid, { rows: next, at: Date.now() });
                setRows(next);
            }, () => { /* declared-only answer is fine */ });
        } catch { /* declared-only answer is fine */ }
        return () => { cancelled = true; };
    }, [uid]);

    const now = Date.now();
    const observed = observedActivityTypes(rows, { sinceMs: now - RELEVANCE_WINDOW_MS, includeManual: true });
    // Referentially stable across renders (consumers memo on it) — only a
    // genuinely different set produces a new array.
    const relevantKey = relevantActivities(declared, observed).join(',');
    const relevant = useMemo(() => (relevantKey ? relevantKey.split(',') : []), [relevantKey]);
    return {
        declared,
        relevant,
        gymRelevant: isGymRelevant(declared, rows, now),
    };
}

/** Is the gym this user's thing? Drives copy that used to assume everyone is
 *  a gym-goer ("your gym check-ins are paused"). */
export function useGymRelevance(): boolean {
    return useActivityRelevance().gymRelevant;
}
