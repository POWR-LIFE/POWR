/**
 * Which answers from claim-points / upgrade-gym-tier are FINAL for a visit.
 *
 * The beacon's settle pass (gym-visit-beacon, Stage 1 dwell / Stage 2 upgrade)
 * re-selects every open, proven, nudge-exhausted visit each minute. Most
 * refusals are worth another go — a 429 rate limit lapses, a 5xx or a network
 * stall is transient. Two are not:
 *
 *   422 "Daily cap reached"  — the session's day is fixed by the visit's
 *                              started_at, so the cap it hit is spent for good.
 *   409 already claimed /    — the unique earn-per-session index or the
 *       already_claimed        one-gym-session-per-day rule; nothing about this
 *                              visit will change that.
 *
 * Before 2026-09-05 nothing remembered a refusal: one member's post-event visit
 * was retried 676 times over 11 hours, each try inserting and deleting an
 * activity_sessions row, until the 12 h reaper closed it. Field-caught on the
 * System Health page as "proven but unpaid" + dead tuples on activity_sessions.
 */
export const TERMINAL_SETTLE_STATUSES: readonly number[] = [409, 422];

export function settleIsTerminal(status: number): boolean {
  return TERMINAL_SETTLE_STATUSES.includes(status);
}
