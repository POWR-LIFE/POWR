import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    clearBackgroundHealth,
    deriveSetupVerdict,
    dismissBackgroundHealthToday,
    isBackgroundHealthDismissedToday,
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
