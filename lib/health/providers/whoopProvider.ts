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
import { HealthProviderNotImplementedError, ProviderAuthExpiredError } from './types';

/**
 * Thrown when the Whoop refresh token has expired or been revoked.
 * Extends the generic ProviderAuthExpiredError so callers can catch either.
 */
export class WhoopAuthExpiredError extends ProviderAuthExpiredError {
    constructor(detail?: string) {
        super('whoop', detail);
        this.name = 'WhoopAuthExpiredError';
    }
}

const META: HealthProviderMeta = {
    id: 'whoop',
    name: 'Whoop',
    native: false,
    capabilities: ['activities', 'sleep', 'heart-rate', 'calories'],
};

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const API_BASE = 'https://api.prod.whoop.com/developer/v2';
const CLIENT_ID = '0c53e79c-9f1c-4ddb-be48-ed67b6d73753';
const REDIRECT_URI = 'powr://whoop-callback';
const SCOPES = [
    'read:recovery',
    'read:cycles',
    'read:sleep',
    'read:workout',
    'read:body_measurement',
    'read:profile',
];
const TOKEN_KEY = 'whoop.tokens.v1';
const PENDING_KEY = 'whoop.pending.v1';

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

function fromWhoopTokenPayload(p: any): StoredTokens {
    const expiresInMs = (p.expires_in ?? 3600) * 1000;
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
    const { data, error } = await supabase.functions.invoke('whoop-oauth', { body });
    // supabase.functions.invoke still returns `data` on non-2xx, so check it first
    if (data?.error || data?.errors) {
        throw new Error(`whoop-oauth: ${JSON.stringify(data)}`);
    }
    if (error) throw new Error(`whoop-oauth broker failed: ${error.message}`);
    return data;
}

async function refreshIfNeeded(tokens: StoredTokens): Promise<StoredTokens> {
    if (Date.now() < tokens.expires_at) return tokens;
    try {
        const payload = await callBroker({ action: 'refresh', refresh_token: tokens.refresh_token });
        const next = fromWhoopTokenPayload(payload);
        await saveTokens(next);
        return next;
    } catch (e: any) {
        // Refresh failed — token is expired or revoked. Clear stored tokens
        // so isConnected() returns false and the user sees a reconnect prompt.
        await clearTokens();
        throw new WhoopAuthExpiredError(e?.message);
    }
}

// ── Whoop API helper ────────────────────────────────────────────────────────

async function whoopGet<T>(path: string): Promise<T> {
    let tokens = await loadTokens();
    if (!tokens) throw new Error('Whoop not connected');
    tokens = await refreshIfNeeded(tokens);

    const url = `${API_BASE}${path}`;
    let res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (res.status === 401) {
        // Force-refresh and retry once
        try {
            const payload = await callBroker({ action: 'refresh', refresh_token: tokens.refresh_token });
            tokens = fromWhoopTokenPayload(payload);
            await saveTokens(tokens);
        } catch (e: any) {
            await clearTokens();
            throw new WhoopAuthExpiredError(e?.message);
        }
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Whoop API ${res.status}: ${text}`);
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

function isoStart(d: Date): string {
    return `${ymd(d)}T00:00:00.000Z`;
}

function isoEnd(d: Date): string {
    return `${ymd(d)}T23:59:59.999Z`;
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

// ── Sport ID → name ─────────────────────────────────────────────────────────

const SPORT_NAMES: Record<number, string> = {
    // ── Running ──────────────────────────────
    0: 'Running',
    1: 'Cycling',
    // ── Team / ball sports ───────────────────
    16: 'Baseball Sport',
    17: 'Basketball Sport',
    18: 'Rowing',
    19: 'Fencing Sport',
    20: 'Field Hockey Sport',
    21: 'Football Sport',
    22: 'Golf Sport',
    24: 'Ice Hockey Sport',
    25: 'Lacrosse Sport',
    27: 'Rugby Sport',
    28: 'Sailing',
    29: 'Skiing',
    30: 'Soccer Sport',
    31: 'Softball Sport',
    32: 'Squash Sport',
    33: 'Swimming',
    34: 'Tennis Sport',
    35: 'Track & Field Sport',
    36: 'Volleyball Sport',
    37: 'Water Polo Sport',
    38: 'Wrestling Sport',
    39: 'Boxing Sport',
    // ── Fitness ──────────────────────────────
    42: 'Dance',
    43: 'Pilates',
    44: 'Yoga',
    45: 'Weightlifting',
    47: 'Cross Country Skiing',
    48: 'CrossFit',
    49: 'Duathlon Running',
    51: 'Gymnastics Sport',
    52: 'Hiking',
    53: 'Horseback Riding',
    55: 'Kayaking',
    56: 'Martial Arts Sport',
    57: 'Mountain Biking Cycling',
    59: 'Powerlifting',
    60: 'Rock Climbing Sport',
    61: 'Paddleboarding',
    62: 'Triathlon Running',
    63: 'Walking',
    64: 'Surfing Sport',
    65: 'Elliptical',
    66: 'Stairmaster',
    70: 'Meditation',
    71: 'Other',
    73: 'Diving',
    74: 'Operations - Tactical',
    75: 'Operations - Medical',
    76: 'Operations - Flying',
    77: 'Operations - Water',
    82: 'Ultimate Sport',
    83: 'Climber Climbing Sport',
    84: 'Jumping Rope HIIT',
    85: 'Australian Football Sport',
    86: 'Skateboarding',
    87: 'Coaching',
    88: 'Ice Bath',
    89: 'Commuting',
    90: 'Gaming',
    91: 'Snowboarding',
    92: 'Motocross',
    93: 'Caddying',
    94: 'Obstacle Course HIIT',
    95: 'Motor Racing',
    96: 'HIIT',
    97: 'Spin Cycling',
    98: 'Jiu Jitsu Sport',
    99: 'Manual Labor',
    100: 'Cricket Sport',
    101: 'Pickleball Sport',
    102: 'Inline Skating',
    103: 'Box Fitness Boxing Sport',
    104: 'Spikeball Sport',
    105: 'Wheelchair Pushing',
    106: 'Paddle Tennis Sport',
    107: 'Barre Dance',
    108: 'Stage Performance Dance',
    109: 'High Stress Work',
    110: 'Parkour',
    111: 'Gaelic Football Sport',
    112: 'Hurling Sport',
    113: 'Circus Arts',
    121: 'Massage Therapy',
    123: 'Strength Trainer Weightlifting',
    125: 'Watching Sports',
    126: 'Assault Bike Cycling',
    127: 'Kickboxing Sport',
    128: 'Stretching',
    230: 'Table Tennis Sport',
    231: 'Badminton Sport',
    232: 'Netball Sport',
    233: 'Sauna',
    234: 'Disc Golf Sport',
    235: 'Yard Work',
    236: 'Air Compression',
    237: 'Percussive Massage',
    238: 'Paintball Sport',
    239: 'Ice Skating',
    240: 'Handball Sport',
    248: 'F45 Training HIIT',
    249: 'Padel Sport',
    250: 'Barry\'s HIIT',
    251: 'Dedicated Parenting',
    252: 'Stroller Walking',
    253: 'Stroller Jogging Running',
    254: 'Toddlerwearing Walking',
    255: 'Babywearing Walking',
    258: 'Barre3 Dance',
    259: 'Hot Yoga',
    261: 'Stadium Steps',
    262: 'Polo Sport',
    263: 'Musical Performance',
    264: 'Kite Boarding Surfing Sport',
    266: 'Dog Walking',
    267: 'Water Skiing',
    268: 'Wakeboarding',
    269: 'Cooking',
    270: 'Cleaning',
    272: 'Public Speaking',
};

// ── Whoop sport ID → POWR canonical activity type ────────────────────────────
// Used by verifyWorkout and mapWorkout so POWR types are matched correctly
// rather than relying on substring matching against sport display names.
const SPORT_TO_POWR: Record<number, string> = {
    // Running
    0:   'running',
    49:  'running', // Duathlon Running
    62:  'running', // Triathlon Running
    253: 'running', // Stroller Jogging
    // Cycling
    1:   'cycling',
    57:  'cycling', // Mountain Biking
    97:  'cycling', // Spin
    126: 'cycling', // Assault Bike
    // Walking
    63:  'walking',
    52:  'walking', // Hiking
    89:  'walking', // Commuting
    252: 'walking', // Stroller Walking
    254: 'walking', // Toddlerwearing Walking
    255: 'walking', // Babywearing Walking
    266: 'walking', // Dog Walking
    // Swimming
    33:  'swimming',
    73:  'swimming', // Diving
    // Gym / strength / machines
    45:  'gym',     // Weightlifting
    59:  'gym',     // Powerlifting
    65:  'gym',     // Elliptical
    66:  'gym',     // Stairmaster
    123: 'gym',     // Strength Trainer
    128: 'gym',     // Stretching
    // HIIT / high-intensity
    48:  'hiit',    // CrossFit
    84:  'hiit',    // Jumping Rope HIIT
    94:  'hiit',    // Obstacle Course HIIT
    96:  'hiit',    // HIIT
    248: 'hiit',    // F45 Training
    250: 'hiit',    // Barry's HIIT
    // Yoga / mindfulness / pilates
    43:  'yoga',    // Pilates
    44:  'yoga',
    70:  'yoga',    // Meditation
    259: 'yoga',    // Hot Yoga
    // Dance
    42:  'dance',
    107: 'dance',   // Barre
    108: 'dance',   // Stage Performance
    258: 'dance',   // Barre3
    263: 'dance',   // Musical Performance
};

function whoopSportToPOWR(sportId: number): string {
    if (sportId in SPORT_TO_POWR) return SPORT_TO_POWR[sportId];
    const name = (SPORT_NAMES[sportId] ?? '').toLowerCase();
    // Fallback name-based heuristics for unmapped IDs
    if (name.includes('run') || name.includes('jog')) return 'running';
    if (name.includes('cycl') || name.includes('biking') || name.includes('spin')) return 'cycling';
    if (name.includes('swim')) return 'swimming';
    if (name.includes('walk') || name.includes('hik')) return 'walking';
    if (name.includes('dance') || name.includes('barre')) return 'dance';
    if (name.includes('yoga') || name.includes('pilates')) return 'yoga';
    if (name.includes('hiit') || name.includes('crossfit') || name.includes('f45')) return 'hiit';
    if (name.includes('sport') || name.includes('tennis') || name.includes('soccer')
        || name.includes('basketball') || name.includes('football') || name.includes('boxing')
        || name.includes('martial') || name.includes('rugby') || name.includes('golf')
        || name.includes('ski') || name.includes('snowboard') || name.includes('climb')
        || name.includes('kayak') || name.includes('surf') || name.includes('gymnastics')) return 'sports';
    // Default: treat any unrecognised wrist-based workout as gym
    return 'gym';
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function mapWorkout(w: any): HealthActivity {
    const score = w.score ?? {};
    const durationMs = w.end && w.start
        ? new Date(w.end).getTime() - new Date(w.start).getTime()
        : 0;
    return {
        type: SPORT_NAMES[w.sport_id] ?? `Workout ${w.sport_id}`,
        startedAt: w.start ?? new Date().toISOString(),
        durationMin: Math.round(durationMs / 60_000),
        distanceM: score.distance_meter ? Math.round(score.distance_meter) : undefined,
        hrAvg: score.average_heart_rate,
        calories: score.kilojoule ? Math.round(score.kilojoule * 0.239006) : undefined,
    };
}

function mapSleep(s: any): SleepSession | null {
    if (!s) return null;
    const stages = s.score?.stage_summary ?? {};
    const msToH = (ms?: number) => (ms ? +(ms / 3_600_000).toFixed(2) : undefined);
    const totalMs = stages.total_in_bed_time_milli ?? 0;

    // Fall back to end − start when score data isn't available yet (PENDING_SCORE)
    const fallbackMs = (s.end && s.start)
        ? new Date(s.end).getTime() - new Date(s.start).getTime()
        : 0;
    const durationMs = totalMs > 0 ? totalMs : fallbackMs;

    return {
        startedAt: s.start,
        endedAt: s.end,
        durationHours: +(durationMs / 3_600_000).toFixed(2),
        deepHours: msToH(stages.total_slow_wave_sleep_time_milli),
        remHours: msToH(stages.total_rem_sleep_time_milli),
        lightHours: msToH(stages.total_light_sleep_time_milli),
    };
}

function base64UrlEncode(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    // @ts-ignore — btoa exists in RN/Hermes
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Completes the OAuth flow after Whoop redirects back to the app's
 * /whoop-callback route. Reads the pending verifier + state from
 * SecureStore, validates state, exchanges the code for tokens, and
 * persists them.
 */
export async function completeWhoopAuth(code: string, state: string): Promise<boolean> {
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

    await saveTokens(fromWhoopTokenPayload(payload));
    return true;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function createWhoopProvider(): HealthProvider {
    return {
        meta: META,

        async isAvailable() { return true; },

        async isConnected() {
            return !!(await loadTokens());
        },

        async connect() {
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
                `${AUTH_URL}?` +
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    response_type: 'code',
                    scope: SCOPES.join(' '),
                    redirect_uri: REDIRECT_URI,
                    code_challenge: codeChallenge,
                    code_challenge_method: 'S256',
                    state,
                }).toString();

            await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);
            // Handoff to /whoop-callback — that route calls completeWhoopAuth()
            // and is the sole writer of connected state on the profile.
            return 'pending';
        },

        async disconnect() {
            await clearTokens();
        },

        async getStepsToday() {
            // Whoop does not track step counts.
            throw new HealthProviderNotImplementedError('whoop', 'getStepsToday');
        },

        async getActivitiesToday() {
            const today = new Date();
            const data = await whoopGet<{ records: any[] }>(
                `/activity/workout?start=${encodeURIComponent(isoStart(today))}&end=${encodeURIComponent(isoEnd(today))}`,
            );
            // Accept SCORED and PENDING_SCORE — a workout that was just completed
            // may still be processing. We still have start/end times to work with.
            return (data.records ?? [])
                .filter((w: any) => (w.score_state === 'SCORED' || w.score_state === 'PENDING_SCORE') && w.start)
                .map(mapWorkout);
        },

        async getLastNightSleep() {
            // Fetch yesterday + today to catch overnight sleep.
            const yesterday = daysAgo(1);
            const today = new Date();
            const data = await whoopGet<{ records: any[] }>(
                `/activity/sleep?start=${encodeURIComponent(isoStart(yesterday))}&end=${encodeURIComponent(isoEnd(today))}`,
            );
            // Accept SCORED and PENDING_SCORE — unscored sleep still has start/end
            const valid = (data.records ?? [])
                .filter((s: any) => !s.nap && s.start && s.end)
                .sort((a: any, b: any) => new Date(b.end).getTime() - new Date(a.end).getTime());
            return mapSleep(valid[0]);
        },

        async getHeartRateToday(): Promise<HeartRateSummary | null> {
            const today = new Date();
            const [cycles, recoveries] = await Promise.all([
                whoopGet<{ records: any[] }>(
                    `/cycle?start=${encodeURIComponent(isoStart(today))}&end=${encodeURIComponent(isoEnd(today))}`,
                ),
                whoopGet<{ records: any[] }>(
                    `/recovery?start=${encodeURIComponent(isoStart(today))}&end=${encodeURIComponent(isoEnd(today))}`,
                ),
            ]);
            const cycle = (cycles.records ?? []).find((c: any) => c.score_state === 'SCORED');
            const recovery = (recoveries.records ?? []).find((r: any) => r.score_state === 'SCORED');
            if (!cycle?.score && !recovery?.score) return null;
            return {
                avg: cycle?.score?.average_heart_rate ?? 0,
                max: cycle?.score?.max_heart_rate ?? 0,
                resting: recovery?.score?.resting_heart_rate ?? 0,
            };
        },

        async getCaloriesToday(): Promise<CalorieSummary | null> {
            const today = new Date();
            const [cycles, workouts] = await Promise.all([
                whoopGet<{ records: any[] }>(
                    `/cycle?start=${encodeURIComponent(isoStart(today))}&end=${encodeURIComponent(isoEnd(today))}`,
                ),
                whoopGet<{ records: any[] }>(
                    `/activity/workout?start=${encodeURIComponent(isoStart(today))}&end=${encodeURIComponent(isoEnd(today))}`,
                ),
            ]);
            const cycle = (cycles.records ?? []).find((c: any) => c.score_state === 'SCORED');
            const totalKj = cycle?.score?.kilojoule ?? 0;
            const activeKj = (workouts.records ?? [])
                .filter((w: any) => w.score_state === 'SCORED')
                .reduce((sum: number, w: any) => sum + (w.score?.kilojoule ?? 0), 0);
            return {
                total: Math.round(totalKj * 0.239006),
                active: Math.round(activeKj * 0.239006),
            };
        },

        async getWeekHistory(): Promise<DayHealthSummary[]> {
            const start = daysAgo(6);
            const end = new Date();
            const [workouts, sleeps, cycles, recoveries] = await Promise.all([
                whoopGet<{ records: any[] }>(
                    `/activity/workout?start=${encodeURIComponent(isoStart(start))}&end=${encodeURIComponent(isoEnd(end))}`,
                ),
                whoopGet<{ records: any[] }>(
                    `/activity/sleep?start=${encodeURIComponent(isoStart(start))}&end=${encodeURIComponent(isoEnd(end))}`,
                ),
                whoopGet<{ records: any[] }>(
                    `/cycle?start=${encodeURIComponent(isoStart(start))}&end=${encodeURIComponent(isoEnd(end))}`,
                ),
                whoopGet<{ records: any[] }>(
                    `/recovery?start=${encodeURIComponent(isoStart(start))}&end=${encodeURIComponent(isoEnd(end))}`,
                ),
            ]);

            const days: DayHealthSummary[] = [];
            for (let i = 6; i >= 0; i--) {
                const d = daysAgo(i);
                const date = ymd(d);
                const dayStart = isoStart(d);
                const dayEnd = isoEnd(d);
                const inDay = (ts: string) => ts >= dayStart && ts <= dayEnd;

                const dayWorkouts = (workouts.records ?? [])
                    .filter((w: any) => (w.score_state === 'SCORED' || w.score_state === 'PENDING_SCORE') && w.start && inDay(w.start))
                    .map(mapWorkout);

                const daySleep = (sleeps.records ?? [])
                    .filter((s: any) => !s.nap && s.start && s.end && inDay(s.end))
                    .sort((a: any, b: any) => new Date(b.end).getTime() - new Date(a.end).getTime());

                const dayCycle = (cycles.records ?? [])
                    .find((c: any) => c.score_state === 'SCORED' && c.start && inDay(c.start));
                const dayRecovery = (recoveries.records ?? [])
                    .find((r: any) => r.score_state === 'SCORED' && r.created_at && inDay(r.created_at));

                const totalKj = dayCycle?.score?.kilojoule ?? 0;
                const activeKj = dayWorkouts.reduce((s, w) => s + ((w.calories ?? 0) / 0.239006), 0);

                days.push({
                    date,
                    steps: 0, // Whoop does not track steps
                    activities: dayWorkouts,
                    sleep: mapSleep(daySleep[0]),
                    heartRate: (dayCycle?.score || dayRecovery?.score) ? {
                        avg: dayCycle?.score?.average_heart_rate ?? 0,
                        max: dayCycle?.score?.max_heart_rate ?? 0,
                        resting: dayRecovery?.score?.resting_heart_rate ?? 0,
                    } : null,
                    calories: dayCycle ? {
                        total: Math.round(totalKj * 0.239006),
                        active: Math.round(activeKj * 0.239006),
                    } : null,
                });
            }
            return days;
        },

        async verifyWalking(): Promise<VerifyResult> {
            return {
                verified: false,
                actualValue: 0,
                detail: 'Whoop does not track step counts',
            };
        },

        async verifyWorkout(activityType: string, durationMinutes: number): Promise<VerifyResult> {
            const today = new Date();
            const data = await whoopGet<{ records: any[] }>(
                `/activity/workout?start=${encodeURIComponent(isoStart(today))}&end=${encodeURIComponent(isoEnd(today))}`,
            );
            // Accept SCORED and PENDING_SCORE — a recently-completed workout may
            // not yet have a final score, but we can still verify the activity type
            // and duration from the start/end timestamps.
            // Use the sport→POWR mapping for matching (not substring search) so
            // that e.g. "gym" correctly matches "Weightlifting" (sport_id 45).
            const match = (data.records ?? [])
                .filter((w: any) => (w.score_state === 'SCORED' || w.score_state === 'PENDING_SCORE') && w.start && w.end)
                .find((w: any) => {
                    const powrType = whoopSportToPOWR(w.sport_id);
                    const dMs = new Date(w.end).getTime() - new Date(w.start).getTime();
                    const dMin = dMs / 60_000;
                    return powrType === activityType && dMin >= durationMinutes * 0.8;
                });
            if (match) {
                const dur = Math.round(
                    (new Date(match.end).getTime() - new Date(match.start).getTime()) / 60_000,
                );
                return {
                    verified: true,
                    actualValue: dur,
                    detail: `Whoop logged ${dur} min of ${SPORT_NAMES[match.sport_id] ?? 'workout'}`,
                };
            }
            return {
                verified: false,
                actualValue: 0,
                detail: `No matching ${activityType} session found today`,
            };
        },
    };
}
