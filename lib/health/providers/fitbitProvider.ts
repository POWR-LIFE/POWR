import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';

import { supabase } from '@/lib/supabase';
import type {
    CalorieSummary,
    DayHealthSummary,
    HealthActivity,
    HeartRateSummary,
    SleepSession,
    VerifyResult,
} from '@/hooks/useHealthData';
import type { HealthProvider, HealthProviderMeta } from './types';
import { ProviderAuthExpiredError } from './types';

const META: HealthProviderMeta = {
    id: 'fitbit',
    name: 'Fitbit',
    native: false,
    capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
};

const DISCOVERY = {
    authorizationEndpoint: 'https://www.fitbit.com/oauth2/authorize',
    tokenEndpoint: 'https://api.fitbit.com/oauth2/token',
    revocationEndpoint: 'https://api.fitbit.com/oauth2/revoke',
};

const CLIENT_ID = '23VFHJ';
const REDIRECT_URI = 'powr://fitbit-callback';
const SCOPES = ['activity', 'sleep', 'heartrate', 'profile'];
const TOKEN_KEY = 'fitbit.tokens.v1';
const PENDING_KEY = 'fitbit.pending.v1';

type StoredTokens = {
    access_token: string;
    refresh_token: string;
    /** Epoch ms at which access_token expires. */
    expires_at: number;
    user_id?: string;
    scope?: string;
};

// ── Token storage ────────────────────────────────────────────────────────────

async function loadTokens(): Promise<StoredTokens | null> {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as StoredTokens; } catch { return null; }
}

async function saveTokens(t: StoredTokens): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t));
}

async function clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
}

function fromFitbitTokenPayload(p: any): StoredTokens {
    const expiresInMs = (p.expires_in ?? 28800) * 1000;
    return {
        access_token: p.access_token,
        refresh_token: p.refresh_token,
        expires_at: Date.now() + expiresInMs - 60_000, // 60s safety margin
        user_id: p.user_id,
        scope: p.scope,
    };
}

// ── Edge function broker ─────────────────────────────────────────────────────

async function callBroker(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await supabase.functions.invoke('fitbit-oauth', { body });
    if (error) throw new Error(`fitbit-oauth broker failed: ${error.message}`);
    if (data?.error || data?.errors) {
        throw new Error(`fitbit-oauth: ${JSON.stringify(data)}`);
    }
    return data;
}

async function refreshIfNeeded(tokens: StoredTokens): Promise<StoredTokens> {
    if (Date.now() < tokens.expires_at) return tokens;
    try {
        const payload = await callBroker({ action: 'refresh', refresh_token: tokens.refresh_token });
        const next = fromFitbitTokenPayload(payload);
        await saveTokens(next);
        return next;
    } catch (e: any) {
        await clearTokens();
        throw new ProviderAuthExpiredError('fitbit', e?.message);
    }
}

// ── Fitbit Web API helper ────────────────────────────────────────────────────

async function fitbitGet<T>(path: string): Promise<T> {
    let tokens = await loadTokens();
    if (!tokens) throw new Error('Fitbit not connected');
    tokens = await refreshIfNeeded(tokens);

    const url = `https://api.fitbit.com/1${path}`;
    let res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (res.status === 401) {
        // Force-refresh and retry once
        try {
            const payload = await callBroker({ action: 'refresh', refresh_token: tokens.refresh_token });
            tokens = fromFitbitTokenPayload(payload);
            await saveTokens(tokens);
        } catch (e: any) {
            await clearTokens();
            throw new ProviderAuthExpiredError('fitbit', e?.message);
        }
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Fitbit API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function ymd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function mapActivity(a: any): HealthActivity {
    return {
        type: a.activityName ?? a.activityTypeId?.toString() ?? 'activity',
        startedAt: a.startTime ?? new Date().toISOString(),
        durationMin: Math.round((a.duration ?? 0) / 60000),
        distanceM: a.distance ? Math.round(a.distance * 1000) : undefined,
        steps: a.steps,
        hrAvg: a.averageHeartRate,
        calories: a.calories,
    };
}

function mapSleep(s: any): SleepSession | null {
    if (!s) return null;
    const levels = s.levels?.summary ?? {};
    const minToH = (m?: number) => (m ? +(m / 60).toFixed(2) : undefined);
    return {
        startedAt: s.startTime,
        endedAt: s.endTime,
        durationHours: +(s.duration / 3_600_000).toFixed(2),
        deepHours: minToH(levels.deep?.minutes),
        remHours: minToH(levels.rem?.minutes),
        lightHours: minToH(levels.light?.minutes),
    };
}

function base64UrlEncode(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    // @ts-ignore — btoa exists in RN/Hermes
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Completes the OAuth flow after Fitbit redirects back to the app's
 * /fitbit-callback route. Reads the pending verifier + state from
 * SecureStore, validates state, exchanges the code for tokens, and
 * persists them.
 */
export async function completeFitbitAuth(code: string, state: string): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    if (!raw) return false;
    let pending: { codeVerifier: string; state: string };
    try { pending = JSON.parse(raw); } catch { return false; }
    if (pending.state !== state) return false;

    const payload = await callBroker({
        action: 'exchange',
        code,
        code_verifier: pending.codeVerifier,
        redirect_uri: REDIRECT_URI,
    });
    await SecureStore.deleteItemAsync(PENDING_KEY);
    if (!payload?.access_token) return false;

    await saveTokens(fromFitbitTokenPayload(payload));
    return true;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function createFitbitProvider(): HealthProvider {
    return {
        meta: META,

        async isAvailable() { return true; },

        async isConnected() {
            return !!(await loadTokens());
        },

        async connect() {
            // Start the OAuth flow. The redirect lands on /fitbit-callback
            // inside the app (see app/fitbit-callback.tsx) which then calls
            // completeFitbitAuth() to exchange the code.
            const codeVerifier = base64UrlEncode(Crypto.getRandomBytes(32));
            const challengeHash = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                codeVerifier,
                { encoding: Crypto.CryptoEncoding.BASE64 },
            );
            const codeChallenge = challengeHash
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const state = base64UrlEncode(Crypto.getRandomBytes(16));

            await SecureStore.setItemAsync(
                PENDING_KEY,
                JSON.stringify({ codeVerifier, state }),
            );

            const authUrl =
                `${DISCOVERY.authorizationEndpoint}?` +
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    response_type: 'code',
                    scope: SCOPES.join(' '),
                    redirect_uri: REDIRECT_URI,
                    code_challenge: codeChallenge,
                    code_challenge_method: 'S256',
                    state,
                    prompt: 'login consent',
                }).toString();

            await WebBrowser.openBrowserAsync(authUrl);
            // Handoff to /fitbit-callback — that route calls completeFitbitAuth()
            // and is the sole writer of connected state on the profile.
            return 'pending';
        },

        async disconnect() {
            await clearTokens();
        },

        async getStepsToday() {
            const today = ymd(new Date());
            const data = await fitbitGet<{ 'activities-steps': { value: string }[] }>(
                `/user/-/activities/steps/date/${today}/1d.json`,
            );
            return Number(data['activities-steps']?.[0]?.value ?? 0);
        },

        async getActivitiesToday() {
            const today = ymd(new Date());
            const data = await fitbitGet<{ activities: any[] }>(
                `/user/-/activities/list.json?afterDate=${today}&sort=asc&offset=0&limit=20`,
            );
            return (data.activities ?? []).map(mapActivity);
        },

        async getLastNightSleep() {
            const today = ymd(new Date());
            const data = await fitbitGet<{ sleep: any[] }>(
                `/1.2/user/-/sleep/date/${today}.json`.replace('/1/1.2', '/1.2'),
            ).catch(async () => {
                // Fitbit sleep is on v1.2 — fetch directly.
                const tokens = await refreshIfNeeded((await loadTokens())!);
                const res = await fetch(`https://api.fitbit.com/1.2/user/-/sleep/date/${today}.json`, {
                    headers: { Authorization: `Bearer ${tokens.access_token}` },
                });
                return res.ok ? res.json() : { sleep: [] };
            });
            const main = (data.sleep ?? []).find((s: any) => s.isMainSleep) ?? data.sleep?.[0];
            return mapSleep(main);
        },

        async getHeartRateToday(): Promise<HeartRateSummary | null> {
            const today = ymd(new Date());
            const data = await fitbitGet<any>(
                `/user/-/activities/heart/date/${today}/1d.json`,
            );
            const summary = data['activities-heart']?.[0]?.value;
            if (!summary) return null;
            const zones: any[] = summary.heartRateZones ?? [];
            const maxZone = zones.reduce(
                (m, z) => (z.max > (m?.max ?? 0) ? z : m),
                null as any,
            );
            return {
                avg: Math.round(
                    zones.reduce((s, z) => s + (z.minutes ?? 0) * ((z.min + z.max) / 2), 0) /
                        Math.max(zones.reduce((s, z) => s + (z.minutes ?? 0), 0), 1),
                ),
                max: maxZone?.max ?? 0,
                resting: summary.restingHeartRate ?? 0,
            };
        },

        async getCaloriesToday(): Promise<CalorieSummary | null> {
            const today = ymd(new Date());
            const [active, total] = await Promise.all([
                fitbitGet<any>(`/user/-/activities/activityCalories/date/${today}/1d.json`),
                fitbitGet<any>(`/user/-/activities/calories/date/${today}/1d.json`),
            ]);
            return {
                active: Number(active['activities-activityCalories']?.[0]?.value ?? 0),
                total: Number(total['activities-calories']?.[0]?.value ?? 0),
            };
        },

        async getWeekHistory(): Promise<DayHealthSummary[]> {
            const start = ymd(daysAgo(6));
            const end = ymd(new Date());
            const steps = await fitbitGet<any>(
                `/user/-/activities/steps/date/${start}/${end}.json`,
            );
            const series: { dateTime: string; value: string }[] = steps['activities-steps'] ?? [];

            // Fetch per-day activities + sleep in parallel (small N=7).
            const results = await Promise.all(series.map(async (d) => {
                const [acts, sleep] = await Promise.all([
                    fitbitGet<{ activities: any[] }>(
                        `/user/-/activities/list.json?afterDate=${d.dateTime}&sort=asc&offset=0&limit=20`,
                    ).catch(() => ({ activities: [] })),
                    (async () => {
                        const tokens = await refreshIfNeeded((await loadTokens())!);
                        const res = await fetch(
                            `https://api.fitbit.com/1.2/user/-/sleep/date/${d.dateTime}.json`,
                            { headers: { Authorization: `Bearer ${tokens.access_token}` } },
                        );
                        return res.ok ? (await res.json()) : { sleep: [] };
                    })(),
                ]);
                const dayActs = (acts.activities ?? [])
                    .filter((a: any) => (a.startTime ?? '').startsWith(d.dateTime))
                    .map(mapActivity);
                const mainSleep = (sleep.sleep ?? []).find((s: any) => s.isMainSleep) ?? sleep.sleep?.[0];
                return {
                    date: d.dateTime,
                    steps: Number(d.value),
                    activities: dayActs,
                    sleep: mapSleep(mainSleep),
                    heartRate: null,
                    calories: null,
                } satisfies DayHealthSummary;
            }));

            return results;
        },

        async verifyWalking(claimedSteps: number): Promise<VerifyResult> {
            const today = ymd(new Date());
            const data = await fitbitGet<{ 'activities-steps': { value: string }[] }>(
                `/user/-/activities/steps/date/${today}/1d.json`,
            );
            const actual = Number(data['activities-steps']?.[0]?.value ?? 0);
            return {
                verified: actual >= claimedSteps * 0.8,
                actualValue: actual,
                detail: `Fitbit recorded ${actual.toLocaleString()} steps today`,
            };
        },

        async verifyWorkout(activityType: string, durationMinutes: number): Promise<VerifyResult> {
            const today = ymd(new Date());
            const data = await fitbitGet<{ activities: any[] }>(
                `/user/-/activities/list.json?afterDate=${today}&sort=asc&offset=0&limit=20`,
            );
            const match = (data.activities ?? []).find((a: any) => {
                const name = (a.activityName ?? '').toLowerCase();
                const dMin = (a.duration ?? 0) / 60_000;
                return name.includes(activityType.toLowerCase()) && dMin >= durationMinutes * 0.8;
            });
            const actualDur = match ? Math.round((match.duration ?? 0) / 60_000) : 0;
            return {
                verified: !!match,
                actualValue: actualDur,
                detail: match
                    ? `Fitbit logged ${actualDur} min of ${match.activityName}`
                    : `No matching ${activityType} session found today`,
            };
        },
    };
}
