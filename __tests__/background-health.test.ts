import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    clearBackgroundHealth,
    deriveSetupVerdict,
    dismissBackgroundHealthToday,
    isBackgroundHealthDismissedToday,
    NO_FIX_STREAK_BROKEN,
    readBackgroundHealth,
    recordBackgroundHealth,
    type BackgroundHealth,
    type BackgroundOutcome,
} from '@/lib/backgroundHealth';

const at = 1_754_700_000_000; // fixed instant; the verdict never reads the clock

const health = (over: Partial<BackgroundHealth> = {}): BackgroundHealth => ({
    at,
    outcome: 'no_permission',
    permBg: 'denied',
    ...over,
});

beforeEach(async () => {
    await AsyncStorage.clear();
});

describe('deriveSetupVerdict — fires only on recorded negative outcomes', () => {
    it('fires when a headless sweep was refused for want of background permission', () => {
        expect(deriveSetupVerdict({ health: health(), backgroundGrantedNow: false }))
            .toBe('location-background');
    });

    it('fires when the live foreground probe FAILED (null is not consent to stay quiet)', () => {
        // A failed read must not suppress a verdict the background already proved.
        expect(deriveSetupVerdict({ health: health(), backgroundGrantedNow: null }))
            .toBe('location-background');
    });
});

describe('deriveSetupVerdict — silence is never evidence', () => {
    it('says nothing when no sweep has ever been recorded', () => {
        // The dominant false positive: 20 of 22 active devices are iOS, where a
        // stationary user with a perfect setup emits nothing for days.
        expect(deriveSetupVerdict({ health: null, backgroundGrantedNow: false })).toBeNull();
    });

    it.each(['handoff', 'no_fix', 'session_active', 'exit_backstop', 'error'] as const)(
        'says nothing when the last outcome was %s',
        outcome => {
            expect(deriveSetupVerdict({ health: health({ outcome }), backgroundGrantedNow: false }))
                .toBeNull();
        },
    );

    it('says nothing about an OLD negative once a newer healthy sweep supersedes it', () => {
        // Last-write-wins: a branch that DID observe a live grant retires it.
        expect(deriveSetupVerdict({
            health: health({ outcome: 'handoff', at: at + 60_000 }),
            backgroundGrantedNow: false,
        })).toBeNull();
    });
});

describe('only permission-observing sweep branches may clear the evidence', () => {
    // Regression guard. `session_active`, `exit_backstop` and `error` all return
    // ABOVE the sweep's permission read, so they cannot observe it. They used to
    // write a record anyway, which erased a real 'no_permission' with a
    // non-observation — and because a permissionless device can never close its
    // own stored session under the live 'observe' close mode, the session_active
    // rewrite repeated on every wake and hid the banner permanently.
    const OBSERVES: BackgroundOutcome[] = ['no_permission', 'handoff', 'no_fix'];
    const BLIND: BackgroundOutcome[] = ['session_active', 'exit_backstop', 'error'];

    it('the sweep records ONLY from branches below the permission read', () => {
        const src = readFileSync(
            join(__dirname, '..', 'context', 'GeofenceContext.tsx'), 'utf8',
        );
        const recorded = [...src.matchAll(/recordBackgroundHealth\(\s*'([a-z_]+)'/g)].map(m => m[1]);

        expect(new Set(recorded)).toEqual(new Set(OBSERVES));
        for (const blind of BLIND) expect(recorded).not.toContain(blind);
    });
});

describe('deriveSetupVerdict — the live probe may suppress but never accuse', () => {
    it('stays quiet when the OS now says background location is granted', () => {
        // Covers both the fixed-it-since case and the documented disagreement
        // between foreground and headless reads on the same device.
        expect(deriveSetupVerdict({ health: health(), backgroundGrantedNow: true })).toBeNull();
    });

    it('never manufactures a verdict from the probe alone', () => {
        expect(deriveSetupVerdict({ health: null, backgroundGrantedNow: false })).toBeNull();
        expect(deriveSetupVerdict({ health: null, backgroundGrantedNow: null })).toBeNull();
    });
});

describe('deriveSetupVerdict — offers a rung the OS will actually grant', () => {
    // Shipped bug, caught on both field devices 2026-08-09 sitting at
    // 'undetermined': the verdict was always 'location-background', whose CTA
    // asks for ACCESS_BACKGROUND_LOCATION alone. Android 11+ auto-denies that
    // when foreground is missing — no dialog — and PermissionFixScreen's Android
    // branch has no else, so FIX IT was a dead button for anyone holding nothing.
    it('asks for foreground first when the user holds no location permission at all', () => {
        expect(deriveSetupVerdict({
            health: health(),
            backgroundGrantedNow: false,
            foregroundGrantedNow: false,
        })).toBe('location');
    });

    it('still asks for background when foreground is already granted', () => {
        expect(deriveSetupVerdict({
            health: health(),
            backgroundGrantedNow: false,
            foregroundGrantedNow: true,
        })).toBe('location-background');
    });

    it.each([
        ['a failed read (null)', null],
        ['an absent field (undefined)', undefined],
    ])('does not downgrade the rung on %s', (_label, foregroundGrantedNow) => {
        // Same discipline as backgroundGrantedNow: only an EXPLICIT false moves
        // the verdict. An unreadable probe leaves the background evidence alone.
        expect(deriveSetupVerdict({
            health: health(),
            backgroundGrantedNow: false,
            foregroundGrantedNow,
        })).toBe('location-background');
    });

    it('never lets the foreground probe manufacture a verdict on its own', () => {
        expect(deriveSetupVerdict({
            health: null,
            backgroundGrantedNow: false,
            foregroundGrantedNow: false,
        })).toBeNull();
        expect(deriveSetupVerdict({
            health: health({ outcome: 'handoff' }),
            backgroundGrantedNow: false,
            foregroundGrantedNow: false,
        })).toBeNull();
    });

    it('keeps the background suppression ahead of the rung choice', () => {
        // Background granted ends it, whatever the foreground probe says.
        expect(deriveSetupVerdict({
            health: health(),
            backgroundGrantedNow: true,
            foregroundGrantedNow: false,
        })).toBeNull();
    });

    it('the hook actually supplies the foreground probe', () => {
        // The verdict being right is worthless if nothing passes the input —
        // which is precisely how the dead button shipped. Pin the call site.
        const src = readFileSync(
            join(__dirname, '..', 'hooks', 'useSetupHealth.ts'), 'utf8',
        );
        expect(src).toMatch(/getForegroundPermissionsAsync/);
        expect(src).toMatch(/foregroundGrantedNow:/);
    });
});

describe('repeated no_fix — the iOS provisional-Always window', () => {
    // 2026-08-09: jpowr reported location_permission 'always' for 24 minutes while
    // background location was genuinely dead, swept no_fix four times, and armed 20
    // regions with lat/lng/sentinel all null. Apple's deferred Always prompt had not
    // been answered. The live probe said granted throughout.

    it('stays quiet on a single no_fix (stale cache, self-heals)', () => {
        expect(deriveSetupVerdict({
            health: health({ outcome: 'no_fix', streak: 1 }),
            backgroundGrantedNow: true,
        })).toBeNull();
    });

    it('stays quiet below the streak threshold', () => {
        expect(deriveSetupVerdict({
            health: health({ outcome: 'no_fix', streak: NO_FIX_STREAK_BROKEN - 1 }),
            backgroundGrantedNow: true,
        })).toBeNull();
    });

    it('fires once the streak proves the device cannot locate itself', () => {
        expect(deriveSetupVerdict({
            health: health({ outcome: 'no_fix', streak: NO_FIX_STREAK_BROKEN }),
            backgroundGrantedNow: true,
        })).toBe('location-background');
    });

    it('fires THROUGH the granted probe — that probe is what is lying here', () => {
        // Every other branch treats backgroundGrantedNow === true as decisive.
        // This one must not, or it goes silent in exactly its own headline case.
        expect(deriveSetupVerdict({
            health: health({ outcome: 'no_fix', streak: 4 }),
            backgroundGrantedNow: true,
            foregroundGrantedNow: true,
        })).toBe('location-background');
    });

    it('treats a legacy record with no streak as a first sighting', () => {
        expect(deriveSetupVerdict({
            health: health({ outcome: 'no_fix', streak: undefined }),
            backgroundGrantedNow: true,
        })).toBeNull();
    });
});

describe('streak counting', () => {
    it('counts consecutive identical outcomes', async () => {
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('no_fix');
        expect((await readBackgroundHealth())?.streak).toBe(3);
    });

    it('resets the streak when the outcome changes', async () => {
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('handoff');
        const got = await readBackgroundHealth();
        expect(got?.outcome).toBe('handoff');
        expect(got?.streak).toBe(1);
    });

    it('a single healthy sweep retires a qualifying no_fix streak', async () => {
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('no_fix');
        await recordBackgroundHealth('handoff');
        expect(deriveSetupVerdict({
            health: await readBackgroundHealth(),
            backgroundGrantedNow: null,
        })).toBeNull();
    });
});

describe('record / read round-trip', () => {
    it('persists and reads back an outcome', async () => {
        await recordBackgroundHealth('no_permission', 'denied');
        const got = await readBackgroundHealth();
        expect(got?.outcome).toBe('no_permission');
        expect(got?.permBg).toBe('denied');
        expect(typeof got?.at).toBe('number');
    });

    it('last write wins, so a healthy sweep overwrites a broken one', async () => {
        await recordBackgroundHealth('no_permission', 'denied');
        await recordBackgroundHealth('handoff', 'granted');
        expect((await readBackgroundHealth())?.outcome).toBe('handoff');
    });

    it('returns null when nothing was ever written', async () => {
        expect(await readBackgroundHealth()).toBeNull();
    });

    it('returns null on a corrupt record rather than throwing into the sweep', async () => {
        await AsyncStorage.setItem('@powr/bg_health', 'not json');
        expect(await readBackgroundHealth()).toBeNull();
    });

    it('returns null on a structurally wrong record', async () => {
        await AsyncStorage.setItem('@powr/bg_health', JSON.stringify({ outcome: 'no_permission' }));
        expect(await readBackgroundHealth()).toBeNull();
    });

    it('clears', async () => {
        await recordBackgroundHealth('no_permission', 'denied');
        await clearBackgroundHealth();
        expect(await readBackgroundHealth()).toBeNull();
    });
});

describe('dismissal is for the day, not forever', () => {
    it('is not dismissed by default', async () => {
        expect(await isBackgroundHealthDismissedToday()).toBe(false);
    });

    it('is dismissed after dismissing', async () => {
        await dismissBackgroundHealthToday();
        expect(await isBackgroundHealthDismissedToday()).toBe(true);
    });

    it('lapses when the day key changes', async () => {
        await dismissBackgroundHealthToday();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        jest.spyOn(global, 'Date').mockImplementation(() => tomorrow as unknown as Date);
        try {
            expect(await isBackgroundHealthDismissedToday()).toBe(false);
        } finally {
            jest.restoreAllMocks();
        }
    });
});
