/**
 * Ledger and Vault text in the reader's language.
 *
 * point_transactions.description and vault_deposits.description are English
 * the SERVER wrote ("Welcome bonus", "4-day streak bonus", "Attended ONE LDN",
 * "running over the daily cap"). They're data, not UI strings, so they can't
 * be keys. Instead each fixed template the server writes is recognised here and
 * re-said from the catalogs; the variable part keeps its stored value when it's
 * a name (event, reward, challenge title, an admin's label) and is re-read when
 * it's something the app can say itself (an activity type, a count).
 *
 * Anything not recognised comes back exactly as stored, so a new server string
 * shows in English until it's added here, never blank or garbled. English
 * output is the stored text itself, byte for byte, with three deliberate
 * exceptions: the two reversal rows that embedded raw uuids, and the legacy
 * weekly bonus that ended in a challenge id (__tests__/pointsLabels.test.ts).
 *
 * The writers, so the list can be kept in step:
 *   supabase/functions: award-bonus, claim-points, upgrade-gym-tier,
 *     terra-webhook, admin-review-session, redeem-reward (spend_points),
 *     complete-weekly-challenge, resolve-shared-challenges,
 *     _shared/sharedChallengeEval + sharedChallengePooled
 *   supabase/migrations: vault release ('Vault unlocked'), referral and invite
 *     triggers, creator programmes, live-event attendance, gym-upgrade backfill
 *   landing-page admin: 'Manual adjustment by admin' (an admin's own text stays)
 * Superseded server code still matters: its rows stay in members' history.
 *
 * Read at render time, never at module level — each call is in the language on
 * screen when it runs.
 */
import { challengeTemplateTitle, weeklyChallengeTitleByName } from '@/lib/challengeText';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import i18n from '@/lib/i18n';

type Params = Record<string, string | number>;

/** What a ledger row says about itself besides the description. */
export type PointsEntryContext = {
    /** point_transactions.source — 'event_attendance', 'shared_challenge', … */
    source?: string | null;
    /** point_transactions.type — 'earn', 'redeem', 'penalty', … */
    kind?: string | null;
};

/** The activity as a word inside a sentence ("gym", "running"), the way other screens do it. */
function activityInSentence(type: string): string | null {
    const config = ACTIVITIES[type as ActivityType];
    if (!config) return null;
    // English keeps the word the server wrote ("hiit session", not "hiit / classes session").
    return (i18n.language || 'en') === 'en' ? type : config.label.toLowerCase();
}

/** Server stand-in when an event row has no name (coalesce(name, 'a live event')). */
const NO_EVENT_NAME = 'a live event';
/** Server stand-in when a Together template has no title (template?.title ?? 'Challenge'). */
const NO_CHALLENGE_TITLE = 'Challenge';

function challengeTitle(stored: string): string {
    return stored === NO_CHALLENGE_TITLE ? i18n.t('points:transaction.challengeFallback') : challengeTemplateTitle(stored);
}

/** Fixed descriptions, word for word as stored. */
const EXACT: Record<string, string> = {
    // award-bonus
    'Welcome bonus': 'points:transaction.welcomeBonus',
    'Location permission granted': 'points:transaction.locationGranted',
    'Wearable connected': 'points:transaction.wearableConnected',
    'Health data connected': 'points:transaction.healthConnected',
    // vault release (claim_vault_deposits / the auto-release sweep)
    'Vault unlocked': 'points:transaction.vaultUnlocked',
    // referrals: live triggers, then the June 2026 award_referral
    'Your friend joined POWR': 'points:transaction.friendJoined',
    'Your friend logged their first workout': 'points:transaction.friendFirstWorkout',
    'First workout done — invite reward unlocked': 'points:transaction.inviteRewardUnlocked',
    'Invite code reward': 'points:transaction.inviteCodeReward',
    'A friend joined with your code': 'points:transaction.friendJoinedWithCode',
    // creator programme
    'Someone entered your code': 'points:transaction.creatorSignup',
    'A signup from your link logged their first workout': 'points:transaction.creatorConversion',
    // admin portal's default when the admin types nothing
    'Manual adjustment by admin': 'points:transaction.adminAdjustment',
    // 20260801160000_backfill_missed_gym_upgrades
    'gym session upgrade (backfill)': 'points:transaction.gymUpgradeBackfill',
};

type Pattern = {
    re: RegExp;
    /** Only rows with one of these sources/types qualify (guards the broad patterns). */
    sources?: string[];
    kinds?: string[];
    /** The translated label, or null when a captured part isn't one the app knows. */
    say: (m: RegExpMatchArray) => string | null;
};

const withActivity = (key: string, type: string, extra: Params = {}): string | null => {
    const activity = activityInSentence(type);
    return activity == null ? null : i18n.t(key, { activity, ...extra });
};

const PATTERNS: Pattern[] = [
    // claim-points: the base row, `${session.type} session`
    { re: /^(\w+) session$/, say: (m) => withActivity('points:transaction.session', m[1]) },
    // upgrade-gym-tier: `gym session upgrade (${upgradeMin}min)`
    {
        re: /^gym session upgrade \((\d+)min\)$/,
        say: (m) => i18n.t('points:transaction.gymUpgrade', { minutes: m[1] }),
    },
    // claim-points: `${currentStreak}-day streak bonus`
    {
        re: /^(\d+)-day streak bonus$/,
        say: (m) => i18n.t('points:transaction.streakBonus', { count: Number(m[1]) }),
    },
    // complete-weekly-challenge before the catalog (session-linked, May 2026)
    {
        re: /^Early Bird challenge bonus \(3× (\w+)\)$/,
        say: (m) => withActivity('points:transaction.earlyBirdBonus', m[1]),
    },
    // …and its successor, which ended in the challenge's id — dropped here
    {
        re: /^Weekly challenge bonus \(3× (\w+)\) — .+$/,
        say: (m) => withActivity('points:transaction.weeklyBonus', m[1]),
    },
    // claim-points: a geofence check-in outranks a lower-trust session
    {
        re: /^Superseded (\w+) by geofence check-in$/,
        say: (m) => withActivity('points:transaction.supersededByCheckIn', m[1]),
    },
    // terra-webhook: a wearable session outranks a manual log
    {
        re: /^Superseded manual (\w+) by wearable sync$/,
        say: (m) => withActivity('points:transaction.supersededByWearable', m[1]),
    },
    // admin-review-session: `Reversed rejected session ${id} (${session.type})`
    {
        re: /^Reversed rejected session \S+ \((\w+)\)$/,
        say: (m) => withActivity('points:transaction.reversedRejected', m[1]),
    },
    // claim-points: `Reversed twin claim ${id} (winner ${id})`
    {
        re: /^Reversed twin claim \S+ \(winner \S+\)$/,
        say: () => i18n.t('points:transaction.reversedDuplicate'),
    },
    // invite milestones (live-event referrals)
    {
        re: /^(\d+) friends converted — milestone bonus$/,
        say: (m) => i18n.t('points:transaction.milestoneConverted', { count: Number(m[1]) }),
    },
    {
        re: /^(\d+) friends joined — milestone bonus$/,
        say: (m) => i18n.t('points:transaction.milestoneJoined', { count: Number(m[1]) }),
    },
    // creator milestone ladder; the step's label is the admin's own text
    {
        re: /^(\d+) signups converted — (.+)$/,
        say: (m) => i18n.t('points:transaction.creatorStepSignupsConverted', { count: Number(m[1]), label: m[2] }),
    },
    {
        re: /^(\d+) signups — (.+)$/,
        say: (m) => i18n.t('points:transaction.creatorStepSignups', { count: Number(m[1]), label: m[2] }),
    },
    {
        re: /^(\d+) conversions — (.+)$/,
        say: (m) => i18n.t('points:transaction.creatorStepConversions', { count: Number(m[1]), label: m[2] }),
    },
    // creator_event_signup: 'A signup from your link joined ' || coalesce(name, 'a live event')
    {
        re: /^A signup from your link joined (.+)$/,
        say: (m) => m[1] === NO_EVENT_NAME
            ? i18n.t('points:transaction.creatorEventSignupUnnamed')
            : i18n.t('points:transaction.creatorEventSignup', { event: m[1] }),
    },
    // event_attendance: 'Attended ' || coalesce(name, 'a live event')
    {
        re: /^Attended (.+)$/,
        sources: ['event_attendance'],
        say: (m) => m[1] === NO_EVENT_NAME
            ? i18n.t('points:transaction.attendedUnnamed')
            : i18n.t('points:transaction.attended', { event: m[1] }),
    },
    // open_my_drop: 'POWR Drop'; admin_void_drop: 'POWR Drop taken back'
    {
        re: /^POWR Drop$/,
        sources: ['drop'],
        say: () => i18n.t('points:transaction.drop'),
    },
    {
        re: /^POWR Drop taken back$/,
        sources: ['drop_void'],
        say: () => i18n.t('points:transaction.dropVoid'),
    },
    // redeem-reward → spend_points: `Redeemed: ${reward.title}`
    {
        re: /^Redeemed: (.+)$/,
        kinds: ['redeem'],
        say: (m) => i18n.t('points:transaction.redeemed', { reward: m[1] }),
    },
    // complete-weekly-challenge: `Weekly challenge: ${title} (+${points})`
    {
        re: /^Weekly challenge: (.+) \(\+(\d+)\)$/,
        say: (m) => i18n.t('points:transaction.weeklyChallenge', { title: weeklyChallengeTitleByName(m[1]), points: m[2] }),
    },
    // shared challenges: `Together challenge: ${title} (+${base_points})`
    {
        re: /^Together challenge: (.+) \(\+(\d+)\)$/,
        say: (m) => i18n.t('points:transaction.togetherChallenge', { title: challengeTitle(m[1]), points: m[2] }),
    },
    // `Together bonus: ${title} (+${bonus} · ${n} friend${n === 1 ? '' : 's'})`
    {
        re: /^Together bonus: (.+) \(\+(\d+) · (\d+) friends?\)$/,
        say: (m) => i18n.t('points:transaction.togetherBonus', {
            title: challengeTitle(m[1]),
            points: m[2],
            count: Number(m[3]),
        }),
    },
];

function allowed(p: Pattern, ctx: PointsEntryContext): boolean {
    if (p.sources && !p.sources.includes(ctx.source ?? '')) return false;
    if (p.kinds && !p.kinds.includes(ctx.kind ?? '')) return false;
    return true;
}

/**
 * The reader's-language version of a stored point_transactions.description,
 * or null when it isn't a template this file knows.
 */
export function translatePointsDescription(
    description: string | null | undefined,
    ctx: PointsEntryContext = {},
): string | null {
    const text = description?.trim();
    if (!text) return null;
    const exact = EXACT[text];
    if (exact) return i18n.t(exact);
    for (const p of PATTERNS) {
        if (!allowed(p, ctx)) continue;
        const m = text.match(p.re);
        if (!m) continue;
        const said = p.say(m);
        if (said != null) return said;
    }
    return null;
}

const RAW_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** True when stored text carries a raw database id, which a member should never be shown. */
export function hasRawId(text: string): boolean {
    return RAW_ID.test(text);
}

/**
 * The label for a ledger row's description: translated when recognised, as
 * stored otherwise, and null when there's nothing a member should read (no
 * description, or an unrecognised one quoting a raw id) — the caller then
 * uses its own fallback.
 */
export function pointsDescriptionLabel(
    description: string | null | undefined,
    ctx: PointsEntryContext = {},
): string | null {
    if (description == null || !description.trim()) return null;
    const translated = translatePointsDescription(description, ctx);
    if (translated != null) return translated;
    return hasRawId(description) ? null : description;
}

// ─── Vault deposits ──────────────────────────────────────────────────────────

/** admin_grant_vault_deposit's stand-in when the admin leaves the note empty. */
const POWR_DROP = 'POWR drop';

const CAP_OVERFLOW: Pattern[] = [
    // claim-points: `${session.type} over the daily cap`
    {
        re: /^(\w+) over the daily cap$/,
        say: (m) => withActivity('rewards:vault.deposit.capOverflow', m[1]),
    },
    // claim-points: `${currentStreak}-day streak · ${session.type} over the daily cap`
    {
        re: /^(\d+)-day streak · (\w+) over the daily cap$/,
        say: (m) => withActivity('rewards:vault.deposit.capOverflowStreak', m[2], { count: Number(m[1]) }),
    },
    // upgrade-gym-tier: `gym session upgrade (${upgradeMin}min) · over the daily cap`
    {
        re: /^gym session upgrade \((\d+)min\) · over the daily cap$/,
        say: (m) => i18n.t('rewards:vault.deposit.capOverflowUpgrade', { minutes: m[1] }),
    },
];

/**
 * The reader's-language title of a Vault deposit from its stored description,
 * or null when it has none (the caller falls back by source). Level-up
 * deposits are labelled from their level, not here.
 *
 * An admin grant's description is the admin's own note — open-ended text that
 * shows as typed — except the server's 'POWR drop' stand-in for an empty note.
 */
export function vaultDepositDescriptionLabel(
    source: string | null | undefined,
    description: string | null | undefined,
): string | null {
    const text = description?.trim();
    if (!text) return null;
    if (source === 'drop') return i18n.t('rewards:vault.deposit.drop');
    if (source === 'admin_grant') {
        return text === POWR_DROP ? i18n.t('rewards:vault.deposit.powrDrop') : description!;
    }
    if (source === 'cap_overflow') {
        for (const p of CAP_OVERFLOW) {
            const m = text.match(p.re);
            const said = m ? p.say(m) : null;
            if (said != null) return said;
        }
    }
    return description!;
}
