// ─── Streak-rescue state derivation ──────────────────────────────────────────
// Pure half of the rescue feature, split out of hooks/useStreakRescue so the
// offered/saved/expired boundaries stay unit-testable: the hook now subscribes
// to the activity-revision bus, which reaches GeofenceContext and its native
// task-manager module at import time.

export type RescueRequirementType = 'sessions' | 'gym_sessions' | 'active_days' | 'steps';

export interface StreakRescueOffer {
    id: string;
    /** 'offered' = challenge in progress; 'saved' = completed recently — the
     *  card holds a celebratory state so the win is visible in-app, not only in
     *  the push (which a notifications-off user never sees). */
    state: 'offered' | 'saved';
    lostStreak: number;
    /** The local calendar day (YYYY-MM-DD) that broke the chain — highlighted
     *  in the StreakCard week strip while the offer is live. */
    missedDay: string;
    /** Admin-authored challenge name, e.g. "Back on track". */
    label: string | null;
    requirementType: RescueRequirementType;
    /** Required amount in the requirement's unit (sessions / days / steps). */
    sessionsRequired: number;
    sessionsDone: number;
    expiresAt: string;
}

/**
 * How long the celebratory 'saved' state stays visible after completion.
 *
 * Completion is a SERVER event and routinely happens with the app closed — a
 * Terra backfill at 08:06, or the sweep's backstop at expiry. The clock
 * therefore starts without the user present, and at 24h anyone who completed on
 * Friday morning and next opened the app on Saturday lunchtime got no
 * celebration at all, ever. 72h covers a weekend; the modal is still one-shot,
 * so a wider window costs nothing to anyone who already saw it.
 */
export const SAVED_VISIBLE_MS = 72 * 3600_000;

export interface StreakRescueRow {
    id: string;
    status: string;
    lost_streak: number;
    missed_day?: string | null;
    label?: string | null;
    requirement_type?: string | null;
    sessions_required: number;
    sessions_done: number;
    expires_at: string;
    completed_at?: string | null;
}

/**
 * Pure state derivation from a streak_rescues row. Returns null when nothing
 * should be surfaced.
 */
export function deriveRescueOffer(
    row: StreakRescueRow | null,
    nowMs: number,
): StreakRescueOffer | null {
    if (!row) return null;

    const isLiveOffer = row.status === 'offered' && new Date(row.expires_at).getTime() > nowMs;
    const isFreshSave = row.status === 'completed' && !!row.completed_at
        && nowMs - new Date(row.completed_at).getTime() < SAVED_VISIBLE_MS;
    if (!isLiveOffer && !isFreshSave) return null;

    return {
        id: row.id,
        state: isLiveOffer ? 'offered' : 'saved',
        lostStreak: row.lost_streak,
        missedDay: String(row.missed_day ?? '').slice(0, 10),
        label: row.label ?? null,
        requirementType: (row.requirement_type ?? 'sessions') as RescueRequirementType,
        sessionsRequired: row.sessions_required,
        sessionsDone: row.sessions_done,
        expiresAt: row.expires_at,
    };
}

/**
 * Mon–Sun index of the rescue's missed day when it falls inside the current
 * week strip; null otherwise (the strip only shows this week).
 */
export function rescueDayIndexFor(
    missedDay: string | null | undefined,
    todayIndex: number,
    now: Date = new Date(),
): number | null {
    if (!missedDay) return null;
    const missed = new Date(`${missedDay}T12:00:00`);
    if (Number.isNaN(missed.getTime())) return null;
    const monday = new Date(now);
    monday.setDate(now.getDate() - todayIndex);
    monday.setHours(0, 0, 0, 0);
    const idx = Math.floor((missed.getTime() - monday.getTime()) / 86400000);
    return idx >= 0 && idx <= 6 ? idx : null;
}
