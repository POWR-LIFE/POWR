// ─── Per-activity points breakdown ───────────────────────────────────────────
// Powers the (i) on the Progress page's POWR EARNED metric: "where did this
// number come from?"
//
// This reads the user's OWN ledger rows rather than restating a rate card, and
// that is deliberate. POWR has four independent earn paths (claim-points,
// terra-webhook, native health sync, manual log) which do not agree on what a
// session is worth, and the gym dwell/upgrade thresholds are admin-tunable at
// runtime — so any hardcoded "here's what you earn" copy drifts out of sync
// with what the user was actually paid. Their own rows can't.

import { type ActivityType } from '@/constants/activities';
import {
    MONTH_WINDOW_DAYS,
    dayAnchor,
    monthAnchorEnd,
    weekAnchorMonday,
    type LookbackPeriod,
} from '@/lib/progressLookback';
import { getSessionUser, supabase } from '@/lib/supabase';

export type PointsLedgerRow = {
    id: string;
    amount: number;
    /** point_transactions.type — 'earn', 'streak', 'bonus', 'redeem', … */
    kind: string;
    /** Human label. Falls back to a source-derived one when the row has none. */
    label: string;
    sessionId: string;
    sessionStartedAt: string;
    sessionDurationMin: number;
    verification: string;
};

export type UnpaidSession = {
    id: string;
    startedAt: string;
    durationMin: number;
    verification: string;
};

export type PointsBreakdown = {
    total: number;
    /** Newest session first; rows within a session in ledger order. */
    rows: PointsLedgerRow[];
    /**
     * Sessions in the window that earned nothing — usually below the activity's
     * minimum duration, or superseded by a higher-trust source. Surfacing them
     * answers "I trained, why is this zero?" without guessing at a reason.
     */
    unpaid: UnpaidSession[];
};

const EMPTY: PointsBreakdown = { total: 0, rows: [], unpaid: [] };

/**
 * Inclusive-start, exclusive-end window matching what a D/W/M breakdown view is
 * currently showing, so the sheet's total reconciles with the metric above it.
 */
export function breakdownWindow(period: LookbackPeriod, offset: number): { start: Date; end: Date } {
    if (period === 'D') {
        const start = dayAnchor(offset);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { start, end };
    }
    if (period === 'W') {
        const start = weekAnchorMonday(offset);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return { start, end };
    }
    // M is a trailing 30-day window ending on the anchor day (inclusive).
    const endDay = monthAnchorEnd(offset);
    const start = new Date(endDay);
    start.setDate(start.getDate() - (MONTH_WINDOW_DAYS - 1));
    const end = new Date(endDay);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

/**
 * Best available label for a ledger row. claim-points and upgrade-gym-tier write
 * readable descriptions ("gym session upgrade (40min)", "4-day streak bonus");
 * the health-sync and manual paths write only a `source`, so those get a derived
 * label instead of rendering blank.
 *
 * Historical rows can name thresholds that have since been retuned (the ledger
 * still holds "gym session upgrade (45min)" from when that was the live gate).
 * That is left as-is on purpose — it is what the user was actually paid for.
 */
function labelFor(
    type: ActivityType,
    kind: string,
    description: string | null,
    source: string | null,
): string {
    const desc = description?.trim();
    if (desc) return desc.charAt(0).toUpperCase() + desc.slice(1);

    if (kind === 'streak') return 'Streak bonus';
    if (kind === 'bonus') return 'Bonus';

    switch (source) {
        case 'health_sync':
            // Walking rows are written as tier DELTAS as the day's step count
            // climbs, so a 1-POWR row is a top-up, not a tier value.
            return type === 'walking' ? 'Step tier progress' : 'Synced from your device';
        case 'manual_log':
            return 'Manual log';
        case 'terra':
        case 'terra_webhook':
            return 'Synced from your wearable';
        case 'shared_challenge':
        case 'shared_challenge_bonus':
            return 'Challenge reward';
        default:
            return 'Session';
    }
}

type SessionRow = {
    id: string;
    started_at: string;
    duration_sec: number | null;
    verification: string;
    point_transactions:
        | { id: string; amount: number; type: string; description: string | null; source: string | null; created_at: string }[]
        | null;
};

/**
 * Every point transaction attached to a session of `type` inside the window,
 * newest session first. Only session-linked rows appear here — standalone
 * bonuses (referrals, signup, weekly challenges) have no session to attribute
 * to an activity, which is the same rule `fetchWeeklyMetrics` uses for its
 * per-type totals, so the two agree.
 */
export async function fetchPointsBreakdown(
    type: ActivityType,
    start: Date,
    end: Date,
): Promise<PointsBreakdown> {
    const user = await getSessionUser();
    if (!user) return EMPTY;

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('id, started_at, duration_sec, verification, point_transactions(id, amount, type, description, source, created_at)')
        .eq('user_id', user.id)
        .eq('type', type)
        .gte('started_at', start.toISOString())
        .lt('started_at', end.toISOString())
        .order('started_at', { ascending: false });
    if (error) throw error;

    const sessions = (data ?? []) as unknown as SessionRow[];

    const rows: PointsLedgerRow[] = [];
    const unpaid: UnpaidSession[] = [];
    let total = 0;

    for (const s of sessions) {
        const durationMin = Math.round((s.duration_sec ?? 0) / 60);
        const txs = [...(s.point_transactions ?? [])].sort((a, b) =>
            a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
        );

        if (txs.length === 0) {
            unpaid.push({
                id: s.id,
                startedAt: s.started_at,
                durationMin,
                verification: s.verification,
            });
            continue;
        }

        for (const t of txs) {
            total += t.amount;
            rows.push({
                id: t.id,
                amount: t.amount,
                kind: t.type,
                label: labelFor(type, t.type, t.description, t.source),
                sessionId: s.id,
                sessionStartedAt: s.started_at,
                sessionDurationMin: durationMin,
                verification: s.verification,
            });
        }
    }

    return { total, rows, unpaid };
}
