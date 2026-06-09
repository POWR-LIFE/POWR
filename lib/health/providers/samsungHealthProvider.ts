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
    id: 'samsung-health',
    name: 'Samsung Health',
    platforms: ['android'],
    native: false,
    transport: 'native',
    capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
};

// TODO: verify exact Samsung Health Data Service API URLs against
// developer.samsung.com/health once credentials are approved.
const DISCOVERY = {
    authorizationEndpoint: 'https://account.samsung.com/accounts/v1/SHDS/grantPermission',
    tokenEndpoint: 'https://account.samsung.com/accounts/v1/SHDS/token',
};

const API_BASE = 'https://shealth.samsung.com/v1/users/me';

// Client ID is set at build time once credentials arrive from Samsung.
// Add SAMSUNG_HEALTH_CLIENT_ID to your .env / EAS secrets.
const CLIENT_ID = process.env.EXPO_PUBLIC_SAMSUNG_HEALTH_CLIENT_ID ?? '';
const REDIRECT_URI = 'powr://samsung-health-callback';

const SCOPES = [
    'com.samsung.health.step_count.read',
    'com.samsung.health.exercise.read',
    'com.samsung.health.sleep.read',
    'com.samsung.health.heart_rate.read',
];

const TOKEN_KEY = 'samsung-health.tokens.v1';
const PENDING_KEY = 'samsung-health.pending.v1';

type StoredTokens = {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    user_id?: string;
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

function fromTokenPayload(p: any): StoredTokens {
    const expiresInMs = (p.expires_in ?? 3600) * 1000;
    return {
        access_token: p.access_token,
        refresh_token: p.refresh_token,
        expires_at: Date.now() + expiresInMs - 60_000,
        user_id: p.user_id,
    };
}

// ── Edge function broker ─────────────────────────────────────────────────────

async function callBroker(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await supabase.functions.invoke('samsung-health-oauth', { body });
    if (error) throw new Error(`samsung-health-oauth broker failed: ${error.message}`);
    if (data?.error || data?.errors) {
        throw new Error(`samsung-health-oauth: ${JSON.stringify(data)}`);
    }
    return data;
}

async function refreshIfNeeded(tokens: StoredTokens): Promise<StoredTokens> {
    if (Date.now() < tokens.expires_at) return tokens;
    try {
        const payload = await callBroker({ action: 'refresh', refresh_token: tokens.refresh_token });
        const next = fromTokenPayload(payload);
        await saveTokens(next);
        return next;
    } catch (e: any) {
        await clearTokens();
        throw new ProviderAuthExpiredError('samsung-health', e?.message);
    }
}

// ── Samsung Health Data Service API helper ───────────────────────────────────

async function shGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    let tokens = await loadTokens();
    if (!tokens) throw new Error('Samsung Health not connected');
    tokens = await refreshIfNeeded(tokens);

    const url = new URL(`${API_BASE}/${path}`);
    if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (res.status === 401) {
        await clearTokens();
        throw new ProviderAuthExpiredError('samsung-health');
    }
    if (!res.ok) throw new Error(`Samsung Health API error ${res.status}`);
    return res.json() as Promise<T>;
}

// ── PKCE OAuth flow ──────────────────────────────────────────────────────────

function toBase64Url(buf: Uint8Array): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < buf.length; i += 3) {
        const b0 = buf[i], b1 = buf[i + 1] ?? 0, b2 = buf[i + 2] ?? 0;
        out += chars[b0 >> 2];
        out += chars[((b0 & 3) << 4) | (b1 >> 4)];
        if (i + 1 < buf.length) out += chars[((b1 & 15) << 2) | (b2 >> 6)];
        if (i + 2 < buf.length) out += chars[b2 & 63];
    }
    return out;
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    const verifierBytes = await Crypto.getRandomBytesAsync(32);
    const verifier = toBase64Url(verifierBytes);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(verifier));
    const challenge = toBase64Url(new Uint8Array(digest));
    return { verifier, challenge };
}

export async function startSamsungHealthAuth(): Promise<'pending' | 'failed'> {
    try {
        const { verifier, challenge } = await generatePKCE();
        const state = toBase64Url(await Crypto.getRandomBytesAsync(16));

        await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ verifier, state }));

        const url = new URL(DISCOVERY.authorizationEndpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', CLIENT_ID);
        url.searchParams.set('redirect_uri', REDIRECT_URI);
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');

        await WebBrowser.openAuthSessionAsync(url.toString(), REDIRECT_URI);
        return 'pending';
    } catch {
        return 'failed';
    }
}

export async function completeSamsungHealthAuth(code: string, state: string): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    await SecureStore.deleteItemAsync(PENDING_KEY);
    if (!raw) return false;

    const { verifier, state: savedState } = JSON.parse(raw) as { verifier: string; state: string };
    if (state !== savedState) return false;

    const payload = await callBroker({
        action: 'exchange',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
    });
    if (!payload?.access_token) return false;

    await saveTokens(fromTokenPayload(payload));
    return true;
}

// ── Data shape helpers ───────────────────────────────────────────────────────

// Samsung Health exercise type → POWR activity type mapping.
// Full list: developer.samsung.com/health/android/data/api-reference/exercise-types
const EXERCISE_TYPE_MAP: Record<number, string> = {
    1000: 'walking',
    1001: 'running',
    1002: 'cycling',
    1007: 'swimming',
    1014: 'gym',       // Elliptical → gym
    1017: 'yoga',
    1018: 'yoga',      // Pilates
    1019: 'gym',       // Aerobics
    1044: 'hiit',      // Interval training
    2001: 'sports',
    2002: 'sports',
    2003: 'sports',
    2004: 'sports',
    2005: 'sports',
    2006: 'sports',
    2007: 'sports',
    2008: 'sports',
    2009: 'sports',
    2010: 'sports',
    2011: 'sports',
    2014: 'sports',    // Soccer
    2015: 'sports',    // Basketball
    2016: 'sports',    // Baseball
    2017: 'sports',    // Volleyball
    2019: 'sports',    // Golf
    2022: 'sports',    // Badminton
    2023: 'sports',    // Tennis
    2024: 'sports',    // Squash
    11007: 'dance',
};

function exerciseTypeToActivity(type: number): string {
    return EXERCISE_TYPE_MAP[type] ?? 'gym';
}

// Samsung Health stores times as Unix epoch in milliseconds.
function msToIso(ms: number): string {
    return new Date(ms).toISOString();
}

function dayRange(date: string): { start: string; end: string } {
    const d = new Date(date + 'T00:00:00');
    const start = String(d.getTime());
    d.setDate(d.getDate() + 1);
    const end = String(d.getTime());
    return { start, end };
}

function todayRange(): { start: string; end: string } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { start: String(start), end: String(start + 86_400_000) };
}

// ── Provider implementation ──────────────────────────────────────────────────

export function createSamsungHealthProvider(): HealthProvider {
    return {
        meta: META,

        async isAvailable() {
            return true; // Android-only; platform filter in provider index handles the rest
        },

        async isConnected() {
            const t = await loadTokens();
            return !!t;
        },

        async connect() {
            return startSamsungHealthAuth();
        },

        async disconnect() {
            await clearTokens();
        },

        async getStepsToday(): Promise<number> {
            const { start, end } = todayRange();
            try {
                const data = await shGet<any>('step-daily-trends', { start_time: start, end_time: end });
                const items: any[] = data?.items ?? data?.step_daily_trends ?? [];
                return items.reduce((sum: number, r: any) => sum + (r.count ?? r.step_count ?? 0), 0);
            } catch {
                return 0;
            }
        },

        async getActivitiesToday(): Promise<HealthActivity[]> {
            const { start, end } = todayRange();
            try {
                const data = await shGet<any>('exercises', { start_time: start, end_time: end });
                const items: any[] = data?.items ?? data?.exercises ?? [];
                return items.map((r: any): HealthActivity => ({
                    type: exerciseTypeToActivity(r.exercise_type ?? r.type ?? 0),
                    startedAt: msToIso(r.start_time),
                    durationMin: Math.round((r.duration ?? 0) / 60_000),
                    distanceM: r.distance ?? undefined,
                    steps: r.step_count ?? undefined,
                    hrAvg: r.heart_rate_avg ?? undefined,
                    calories: r.calorie ?? r.calories ?? undefined,
                }));
            } catch {
                return [];
            }
        },

        async getLastNightSleep(): Promise<SleepSession | null> {
            const now = new Date();
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(18, 0, 0, 0);
            const start = String(yesterday.getTime());
            const end = String(now.getTime());
            try {
                const data = await shGet<any>('sleep', { start_time: start, end_time: end });
                const items: any[] = data?.items ?? data?.sleep ?? [];
                if (!items.length) return null;
                const s = items[items.length - 1];

                const totalMs = s.duration ?? (s.end_time - s.start_time);
                const stages: any[] = s.stages ?? s.sleep_stages ?? [];

                const deepMs = stages
                    .filter((st: any) => st.type === 40 || st.stage === 'DEEP')
                    .reduce((sum: number, st: any) => sum + (st.duration ?? 0), 0);
                const remMs = stages
                    .filter((st: any) => st.type === 50 || st.stage === 'REM')
                    .reduce((sum: number, st: any) => sum + (st.duration ?? 0), 0);
                const lightMs = stages
                    .filter((st: any) => [30, 10, 20].includes(st.type) || st.stage === 'LIGHT')
                    .reduce((sum: number, st: any) => sum + (st.duration ?? 0), 0);

                return {
                    startedAt: msToIso(s.start_time),
                    endedAt: msToIso(s.end_time),
                    durationHours: totalMs / 3_600_000,
                    deepHours: deepMs / 3_600_000,
                    remHours: remMs / 3_600_000,
                    lightHours: lightMs / 3_600_000,
                };
            } catch {
                return null;
            }
        },

        async getHeartRateToday(): Promise<HeartRateSummary | null> {
            const { start, end } = todayRange();
            try {
                const data = await shGet<any>('heart-rate', { start_time: start, end_time: end });
                const items: any[] = data?.items ?? data?.heart_rate ?? [];
                if (!items.length) return null;
                const values = items.flatMap((r: any) => r.heart_rate ?? [r.heart_rate_value]).filter(Boolean);
                if (!values.length) return null;
                const avg = Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length);
                const max = Math.max(...values);
                const resting = items.find((r: any) => r.heart_rate_min)?.heart_rate_min ?? undefined;
                return { avg, max, resting };
            } catch {
                return null;
            }
        },

        async getCaloriesToday(): Promise<CalorieSummary | null> {
            const { start, end } = todayRange();
            try {
                const data = await shGet<any>('exercises', { start_time: start, end_time: end });
                const items: any[] = data?.items ?? data?.exercises ?? [];
                const active = items.reduce((sum: number, r: any) => sum + (r.calorie ?? r.calories ?? 0), 0);
                return { active: Math.round(active), total: Math.round(active) };
            } catch {
                return null;
            }
        },

        async getWeekHistory(): Promise<DayHealthSummary[]> {
            const days: DayHealthSummary[] = [];
            const today = new Date();
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const { start, end } = dayRange(dateStr);

                try {
                    const [stepsData, exercisesData, sleepData, hrData] = await Promise.allSettled([
                        shGet<any>('step-daily-trends', { start_time: start, end_time: end }),
                        shGet<any>('exercises', { start_time: start, end_time: end }),
                        shGet<any>('sleep', { start_time: start, end_time: end }),
                        shGet<any>('heart-rate', { start_time: start, end_time: end }),
                    ]);

                    const stepItems = stepsData.status === 'fulfilled'
                        ? (stepsData.value?.items ?? stepsData.value?.step_daily_trends ?? []) : [];
                    const steps = stepItems.reduce((s: number, r: any) => s + (r.count ?? r.step_count ?? 0), 0);

                    const exItems = exercisesData.status === 'fulfilled'
                        ? (exercisesData.value?.items ?? exercisesData.value?.exercises ?? []) : [];
                    const activities: HealthActivity[] = exItems.map((r: any): HealthActivity => ({
                        type: exerciseTypeToActivity(r.exercise_type ?? r.type ?? 0),
                        startedAt: msToIso(r.start_time),
                        durationMin: Math.round((r.duration ?? 0) / 60_000),
                        distanceM: r.distance ?? undefined,
                        steps: r.step_count ?? undefined,
                        hrAvg: r.heart_rate_avg ?? undefined,
                        calories: r.calorie ?? r.calories ?? undefined,
                    }));

                    const sleepItems = sleepData.status === 'fulfilled'
                        ? (sleepData.value?.items ?? sleepData.value?.sleep ?? []) : [];
                    let sleep: SleepSession | undefined;
                    if (sleepItems.length) {
                        const s = sleepItems[sleepItems.length - 1];
                        const totalMs = s.duration ?? (s.end_time - s.start_time);
                        const stages: any[] = s.stages ?? s.sleep_stages ?? [];
                        sleep = {
                            startedAt: msToIso(s.start_time),
                            endedAt: msToIso(s.end_time),
                            durationHours: totalMs / 3_600_000,
                            deepHours: stages.filter((st: any) => st.type === 40 || st.stage === 'DEEP').reduce((a: number, st: any) => a + (st.duration ?? 0) / 3_600_000, 0),
                            remHours: stages.filter((st: any) => st.type === 50 || st.stage === 'REM').reduce((a: number, st: any) => a + (st.duration ?? 0) / 3_600_000, 0),
                            lightHours: stages.filter((st: any) => [30, 10, 20].includes(st.type) || st.stage === 'LIGHT').reduce((a: number, st: any) => a + (st.duration ?? 0) / 3_600_000, 0),
                        };
                    }

                    const hrItems = hrData.status === 'fulfilled'
                        ? (hrData.value?.items ?? hrData.value?.heart_rate ?? []) : [];
                    let heartRate: HeartRateSummary | undefined;
                    if (hrItems.length) {
                        const values = hrItems.flatMap((r: any) => r.heart_rate ?? [r.heart_rate_value]).filter(Boolean);
                        if (values.length) {
                            heartRate = {
                                avg: Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length),
                                max: Math.max(...values),
                            };
                        }
                    }

                    const activeCalories = exItems.reduce((s: number, r: any) => s + (r.calorie ?? r.calories ?? 0), 0);

                    days.push({
                        date: dateStr,
                        steps,
                        activities,
                        sleep,
                        heartRate,
                        calories: activeCalories > 0 ? { active: Math.round(activeCalories), total: Math.round(activeCalories) } : undefined,
                    });
                } catch {
                    days.push({ date: dateStr, steps: 0, activities: [] });
                }
            }
            return days;
        },

        async verifyWalking(claimedSteps: number): Promise<VerifyResult> {
            const actual = await this.getStepsToday();
            const tolerance = 0.80;
            const verified = actual >= claimedSteps * tolerance;
            return {
                verified,
                actualValue: actual,
                detail: verified
                    ? `Samsung Health recorded ${actual.toLocaleString()} steps`
                    : `Samsung Health recorded only ${actual.toLocaleString()} steps (claimed ${claimedSteps.toLocaleString()})`,
            };
        },

        async verifyWorkout(activityType: string, durationMinutes: number): Promise<VerifyResult> {
            const activities = await this.getActivitiesToday();
            const match = activities.find(a =>
                a.type === activityType && a.durationMin >= durationMinutes * 0.75
            );
            if (match) {
                return {
                    verified: true,
                    actualValue: match.durationMin,
                    detail: `Samsung Health recorded ${match.durationMin} min of ${activityType}`,
                };
            }
            return {
                verified: false,
                actualValue: 0,
                detail: `No matching ${activityType} session found in Samsung Health today`,
            };
        },
    };
}
