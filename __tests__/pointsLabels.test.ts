/**
 * Server-written ledger and Vault text, re-said in the reader's language.
 *
 * point_transactions.description and vault_deposits.description are English
 * the server stored. lib/pointsLabels recognises each template and re-says it
 * from the catalogs. The rule that makes this safe to ship by OTA: an English
 * reader sees exactly what was stored, byte for byte, and anything unrecognised
 * passes through untouched.
 */

import { labelFor } from '@/lib/api/pointsBreakdown';
import i18n from '@/lib/i18n';
import {
    pointsDescriptionLabel,
    translatePointsDescription,
    vaultDepositDescriptionLabel,
    type PointsEntryContext,
} from '@/lib/pointsLabels';
import enPoints from '@/shared/i18n/en/app/points.json';

// pointsBreakdown reads Supabase; nothing here touches the network (jest hoists this).
jest.mock('@/lib/supabase', () => ({
    supabase: { from: jest.fn() },
    getSessionUser: jest.fn(),
}));

type Sample = { key: string; stored: string; ctx?: PointsEntryContext };

const UUID_A = '3f6a2c1e-9b0d-4e57-8a21-6c4d2e9f0b13';
const UUID_B = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d';

/** One stored description per template the server writes, current and historical. */
const SAMPLES: Sample[] = [
    // award-bonus
    { key: 'welcomeBonus', stored: 'Welcome bonus', ctx: { kind: 'bonus' } },
    { key: 'locationGranted', stored: 'Location permission granted', ctx: { kind: 'bonus' } },
    { key: 'wearableConnected', stored: 'Wearable connected', ctx: { kind: 'bonus' } },
    { key: 'healthConnected', stored: 'Health data connected', ctx: { kind: 'bonus' } },
    // vault release
    { key: 'vaultUnlocked', stored: 'Vault unlocked', ctx: { kind: 'bonus', source: 'vault_release' } },
    // referrals and invites
    { key: 'friendJoined', stored: 'Your friend joined POWR', ctx: { kind: 'bonus', source: 'referral_sent' } },
    { key: 'friendFirstWorkout', stored: 'Your friend logged their first workout', ctx: { kind: 'bonus', source: 'referral_sent' } },
    { key: 'inviteRewardUnlocked', stored: 'First workout done — invite reward unlocked', ctx: { kind: 'bonus', source: 'referral_received' } },
    { key: 'inviteCodeReward', stored: 'Invite code reward', ctx: { kind: 'bonus', source: 'referral_received' } },
    { key: 'friendJoinedWithCode', stored: 'A friend joined with your code', ctx: { kind: 'bonus', source: 'referral_sent' } },
    { key: 'milestoneConverted', stored: '5 friends converted — milestone bonus', ctx: { kind: 'bonus', source: 'invite_milestone' } },
    { key: 'milestoneJoined', stored: '3 friends joined — milestone bonus', ctx: { kind: 'bonus', source: 'invite_milestone' } },
    // creator programme (the step label is the admin's own text)
    { key: 'creatorSignup', stored: 'Someone entered your code', ctx: { kind: 'bonus', source: 'creator_signup' } },
    { key: 'creatorConversion', stored: 'A signup from your link logged their first workout', ctx: { kind: 'bonus', source: 'creator_conversion' } },
    { key: 'creatorStepSignups', stored: '10 signups — Silver tier', ctx: { kind: 'bonus', source: 'creator_milestone' } },
    { key: 'creatorStepConversions', stored: '25 conversions — Gold tier', ctx: { kind: 'bonus', source: 'creator_milestone' } },
    { key: 'creatorStepSignupsConverted', stored: '5 signups converted — Bronze', ctx: { kind: 'bonus', source: 'creator_milestone' } },
    { key: 'creatorEventSignup', stored: 'A signup from your link joined ONE LDN Friday Night Lights', ctx: { kind: 'bonus', source: 'creator_event_signup' } },
    { key: 'creatorEventSignupUnnamed', stored: 'A signup from your link joined a live event', ctx: { kind: 'bonus', source: 'creator_event_signup' } },
    // live events
    { key: 'attended', stored: 'Attended ONE LDN Friday Night Lights', ctx: { kind: 'bonus', source: 'event_attendance' } },
    { key: 'attendedUnnamed', stored: 'Attended a live event', ctx: { kind: 'bonus', source: 'event_attendance' } },
    // rewards
    { key: 'redeemed', stored: 'Redeemed: 20% off at Gymshark', ctx: { kind: 'redeem' } },
    // challenges
    { key: 'weeklyChallenge', stored: 'Weekly challenge: Lunchtime Grind (+40)', ctx: { kind: 'earn', source: 'weekly_challenge' } },
    { key: 'togetherChallenge', stored: 'Together challenge: 100K Together (+50)', ctx: { kind: 'earn', source: 'shared_challenge' } },
    { key: 'togetherBonus', stored: 'Together bonus: 100K Together (+10 · 1 friend)', ctx: { kind: 'earn', source: 'shared_challenge_bonus' } },
    { key: 'togetherBonus', stored: 'Together bonus: 100K Together (+20 · 2 friends)', ctx: { kind: 'earn', source: 'shared_challenge_bonus' } },
    { key: 'challengeFallback', stored: 'Together challenge: Challenge (+50)', ctx: { kind: 'earn', source: 'shared_challenge' } },
    { key: 'earlyBirdBonus', stored: 'Early Bird challenge bonus (3× gym)', ctx: { kind: 'earn', source: 'weekly_challenge' } },
    // claim-points / upgrade-gym-tier
    { key: 'session', stored: 'gym session', ctx: { kind: 'earn' } },
    { key: 'session', stored: 'running session', ctx: { kind: 'earn' } },
    { key: 'gymUpgrade', stored: 'gym session upgrade (40min)', ctx: { kind: 'earn' } },
    { key: 'gymUpgrade', stored: 'gym session upgrade (45min)', ctx: { kind: 'earn' } },
    { key: 'gymUpgradeBackfill', stored: 'gym session upgrade (backfill)', ctx: { kind: 'earn', source: 'backfill' } },
    { key: 'streakBonus', stored: '4-day streak bonus', ctx: { kind: 'streak' } },
    { key: 'streakBonus', stored: '1-day streak bonus', ctx: { kind: 'streak' } },
    { key: 'supersededByCheckIn', stored: 'Superseded running by geofence check-in', ctx: { kind: 'penalty' } },
    { key: 'supersededByWearable', stored: 'Superseded manual cycling by wearable sync', ctx: { kind: 'penalty' } },
    // admin portal default
    { key: 'adminAdjustment', stored: 'Manual adjustment by admin', ctx: { kind: 'adjustment' } },
];

/** Templates whose English deliberately changes: they quoted raw ids. */
const REWORDED: (Sample & { english: string })[] = [
    {
        key: 'reversedRejected',
        stored: `Reversed rejected session ${UUID_A} (gym)`,
        ctx: { kind: 'penalty' },
        english: 'Reversed rejected gym session',
    },
    {
        key: 'reversedDuplicate',
        stored: `Reversed twin claim ${UUID_A} (winner ${UUID_B})`,
        ctx: { kind: 'penalty' },
        english: 'Reversed duplicate check-in',
    },
    {
        key: 'weeklyBonus',
        stored: `Weekly challenge bonus (3× running) — ${UUID_A}`,
        ctx: { kind: 'earn', source: 'weekly_challenge' },
        english: 'Weekly challenge bonus (3× running)',
    },
];

afterEach(async () => {
    await i18n.changeLanguage('en');
});

describe('English is the stored text, byte for byte', () => {
    it.each(SAMPLES.map((s) => [s.stored, s]))('%s', (_stored, sample) => {
        const s = sample as Sample;
        expect(translatePointsDescription(s.stored, s.ctx)).toBe(s.stored);
        expect(pointsDescriptionLabel(s.stored, s.ctx)).toBe(s.stored);
    });

    it('rewords only the rows that quoted raw ids, and never shows one', () => {
        for (const s of REWORDED) {
            const label = translatePointsDescription(s.stored, s.ctx);
            expect(label).toBe(s.english);
            expect(label).not.toMatch(/[0-9a-f]{8}-/);
        }
    });

    it('has a sample for every template in the catalog', () => {
        const base = (k: string) => k.replace(/_(one|other)$/, '');
        const catalog = new Set(Object.keys(enPoints.transaction).map(base));
        const sampled = new Set([...SAMPLES, ...REWORDED].map((s) => s.key));
        expect([...catalog].filter((k) => !sampled.has(k))).toEqual([]);
    });

    it('keeps the activity word the server wrote in English', () => {
        expect(translatePointsDescription('hiit session', { kind: 'earn' })).toBe('hiit session');
        expect(translatePointsDescription('Superseded yoga by geofence check-in', { kind: 'penalty' }))
            .toBe('Superseded yoga by geofence check-in');
    });
});

describe('unknown text passes through', () => {
    it('shows an unrecognised description as stored', () => {
        expect(translatePointsDescription('Birthday bonus from the team')).toBeNull();
        expect(pointsDescriptionLabel('Birthday bonus from the team')).toBe('Birthday bonus from the team');
    });

    it('keeps an admin adjustment note exactly as typed', () => {
        expect(pointsDescriptionLabel('Refund for the 3 Oct outage', { kind: 'adjustment' })).toBe('Refund for the 3 Oct outage');
    });

    it('leaves an activity it does not know alone', () => {
        expect(translatePointsDescription('kayaking session', { kind: 'earn' })).toBeNull();
        expect(pointsDescriptionLabel('Superseded kayaking by geofence check-in')).toBe('Superseded kayaking by geofence check-in');
    });

    it('only treats a row as an attendance or a redemption when its source and type say so', () => {
        expect(translatePointsDescription('Attended to by the team', { kind: 'adjustment', source: null })).toBeNull();
        expect(translatePointsDescription('Redeemed: manual fix', { kind: 'adjustment' })).toBeNull();
    });

    it('returns nothing for an empty description, or one quoting a raw id', () => {
        expect(pointsDescriptionLabel(null)).toBeNull();
        expect(pointsDescriptionLabel('   ')).toBeNull();
        expect(pointsDescriptionLabel(`Fix for session ${UUID_A}`)).toBeNull();
    });
});

describe('in French and Spanish', () => {
    it('re-says the fixed templates', async () => {
        await i18n.changeLanguage('fr');
        expect(translatePointsDescription('Welcome bonus')).toBe('Bonus de bienvenue');
        expect(translatePointsDescription('Vault unlocked')).toBe('Vault débloqué');
        await i18n.changeLanguage('es');
        expect(translatePointsDescription('Welcome bonus')).toBe('Bonus de bienvenida');
    });

    it('keeps names as stored and translates what the app can say itself', async () => {
        await i18n.changeLanguage('fr');
        expect(translatePointsDescription('Attended ONE LDN', { source: 'event_attendance' }))
            .toBe('Participation : ONE LDN');
        expect(translatePointsDescription('Redeemed: 20% off at Gymshark', { kind: 'redeem' }))
            .toBe('Échangé : 20% off at Gymshark');
        expect(translatePointsDescription('4-day streak bonus')).toBe('Bonus de série de 4 jours');
        expect(translatePointsDescription('1-day streak bonus')).toBe('Bonus de série de 1 jour');
        expect(translatePointsDescription('Superseded running by geofence check-in'))
            .toBe('Remplacé par un check-in en salle (course à pied)');
        expect(translatePointsDescription('Together bonus: 100K Together (+20 · 2 friends)'))
            .toBe('Bonus Ensemble : 100\u202f000 ensemble (+20 · 2 amis)');
        expect(translatePointsDescription('Weekly challenge: Just Run (+15)'))
            .toBe('Défi de la semaine\u00a0: Cours, c’est tout (+15)');
        expect(translatePointsDescription('Together challenge: Challenge (+50)'))
            .toBe('Défi Ensemble : Défi (+50)');

        await i18n.changeLanguage('es');
        expect(translatePointsDescription('gym session')).toBe('Sesión de gimnasio');
        expect(translatePointsDescription('Attended a live event', { source: 'event_attendance' }))
            .toBe('Asistencia a un evento en directo');
        expect(translatePointsDescription(`Reversed rejected session ${UUID_A} (gym)`))
            .toBe('Sesión rechazada, puntos retirados (gimnasio)');
    });

    it('translates every sampled template away from its English', async () => {
        for (const lang of ['fr', 'es']) {
            await i18n.changeLanguage(lang);
            const untranslated = [...SAMPLES, ...REWORDED]
                .filter((s) => translatePointsDescription(s.stored, s.ctx) === s.stored)
                .map((s) => `${lang}: ${s.stored}`);
            expect(untranslated).toEqual([]);
        }
    });
});

describe('Progress points breakdown rows', () => {
    it('keeps its English labels: capitalised descriptions and the source fallbacks', () => {
        expect(labelFor('gym', 'earn', 'gym session', null)).toBe('Gym session');
        expect(labelFor('gym', 'earn', 'gym session upgrade (40min)', null)).toBe('Gym session upgrade (40min)');
        expect(labelFor('gym', 'streak', '4-day streak bonus', null)).toBe('4-day streak bonus');
        expect(labelFor('gym', 'streak', null, null)).toBe('Streak bonus');
        expect(labelFor('gym', 'bonus', null, null)).toBe('Bonus');
        expect(labelFor('walking', 'earn', null, 'health_sync')).toBe('Step tier progress');
        expect(labelFor('running', 'earn', null, 'health_sync')).toBe('Synced from your device');
        expect(labelFor('running', 'earn', null, 'manual_log')).toBe('Manual log');
        expect(labelFor('running', 'earn', null, 'terra_webhook')).toBe('Synced from your wearable');
        expect(labelFor('running', 'earn', null, 'shared_challenge')).toBe('Challenge reward');
        expect(labelFor('running', 'earn', null, null)).toBe('Session');
    });

    it('never shows a raw id: an unknown description quoting one falls back to the activity', () => {
        expect(labelFor('gym', 'penalty', `Clawback ${UUID_A}`, null)).toBe('Gym');
    });

    it('speaks French', async () => {
        await i18n.changeLanguage('fr');
        expect(labelFor('gym', 'earn', 'gym session', null)).toBe('Séance de salle de sport');
        expect(labelFor('gym', 'earn', 'gym session upgrade (40min)', null))
            .toBe('Séance en salle : palier supérieur (40 min)');
        expect(labelFor('walking', 'earn', null, 'health_sync')).toBe('Progression des paliers de pas');
    });
});

describe('Vault deposits', () => {
    it('keeps the English as stored', () => {
        expect(vaultDepositDescriptionLabel('cap_overflow', 'running over the daily cap')).toBe('running over the daily cap');
        expect(vaultDepositDescriptionLabel('cap_overflow', '4-day streak · gym over the daily cap'))
            .toBe('4-day streak · gym over the daily cap');
        expect(vaultDepositDescriptionLabel('cap_overflow', 'gym session upgrade (40min) · over the daily cap'))
            .toBe('gym session upgrade (40min) · over the daily cap');
        expect(vaultDepositDescriptionLabel('admin_grant', 'POWR drop')).toBe('POWR drop');
    });

    it("shows an admin's own grant note as typed, and nothing for no description", () => {
        expect(vaultDepositDescriptionLabel('admin_grant', 'Thanks for the feedback!')).toBe('Thanks for the feedback!');
        expect(vaultDepositDescriptionLabel('admin_grant', null)).toBeNull();
        expect(vaultDepositDescriptionLabel('cap_overflow', '')).toBeNull();
    });

    it('leaves an unrecognised cap-overflow description as stored', () => {
        expect(vaultDepositDescriptionLabel('cap_overflow', 'DEV re-arm test deposit')).toBe('DEV re-arm test deposit');
        expect(vaultDepositDescriptionLabel('cap_overflow', 'kayaking over the daily cap')).toBe('kayaking over the daily cap');
    });

    it('speaks French and Spanish, activity names included', async () => {
        await i18n.changeLanguage('fr');
        expect(vaultDepositDescriptionLabel('cap_overflow', 'running over the daily cap'))
            .toBe('Séance de course à pied au-delà du plafond');
        expect(vaultDepositDescriptionLabel('cap_overflow', '4-day streak · gym over the daily cap'))
            .toBe('Série de 4 jours · salle de sport au-delà du plafond');
        expect(vaultDepositDescriptionLabel('admin_grant', 'POWR drop')).toBe('Cadeau POWR');
        expect(vaultDepositDescriptionLabel('admin_grant', 'Thanks for the feedback!')).toBe('Thanks for the feedback!');

        await i18n.changeLanguage('es');
        expect(vaultDepositDescriptionLabel('cap_overflow', 'gym session upgrade (40min) · over the daily cap'))
            .toBe('Sesión de gimnasio: tramo superior (40 min) · por encima del límite');
        expect(vaultDepositDescriptionLabel('admin_grant', 'POWR drop')).toBe('Regalo POWR');
    });
});
