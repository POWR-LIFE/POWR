import type { LiveEvent } from '@/lib/api/liveEvents';

/**
 * Shared display formatting for live-event surfaces (home card, register
 * sheet, league tab). One place so every surface agrees on how a window
 * reads — especially the half-open [start, end) boundary.
 */

export function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The window is half-open [start, end) — show the last day people can score, not the boundary. */
export function lastDayOf(endIso: string): string {
    return shortDate(new Date(new Date(endIso).getTime() - 60_000).toISOString());
}

export function eventDateRange(event: Pick<LiveEvent, 'window_start_at' | 'window_end_at'>): string {
    return `${shortDate(event.window_start_at)} – ${lastDayOf(event.window_end_at)}`;
}

/**
 * The home card's date line. `window_start_at` is when SCORING opens, which
 * for a venue event is typically the week BEFORE the night itself — so a bare
 * "Thu 27 Aug" there reads as the date of the event and sends people to the
 * wrong day. Name what the date actually is, every time.
 *
 * Once the window is open "starts" is behind us, so the live half names the
 * deadline that's left instead — the same last-scoring-day the League header
 * uses, so the two surfaces can never quote different days.
 */
export function scoringLine(
    event: Pick<LiveEvent, 'status' | 'window_start_at' | 'window_end_at'>,
): string {
    return event.status === 'scheduled'
        ? `Scoring starts ${shortDate(event.window_start_at)}`
        : `Scoring ends ${lastDayOf(event.window_end_at)}`;
}

/** Local wall-clock as a flyer writes it: "6pm", "6:30pm". */
function clockTime(d: Date): string {
    return d
        .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
        // Anchored to the am/pm suffix so it can only ever fire on a whole
        // hour ("7:00 pm" -> "7pm") and never eat the minutes of a 24h time.
        .replace(/:00(?=\s*[ap]\.?m)/i, '')
        .replace(/\s+/g, '')
        .toLowerCase();
}

/** The day, via the same formatter as everything else, for same-day tests. */
function dayKey(d: Date): string {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A doors time that is really just a day: the admin datetime input defaults
 * to 00:00, so local midnight is the shape produced by picking a DAY and not
 * touching the time. Read the clock back through the formatter rather than
 * getHours() so the test agrees with the rendered day across timezones.
 */
function isDateOnly(d: Date): boolean {
    const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return hm === '00:00' || hm === '24:00';
}

/**
 * The moment the seal comes off: the night at the venue, sourced from
 * doors_open_at exactly like [[eventNightLine]] — nothing else on the row
 * records it, and the sealed board must never count down to the scoring
 * window (that is the boundary already behind us once the board is locked).
 *
 * `exact` is false for a date-only doors time: count DAYS to a day the admin
 * picked, never seconds to a midnight nobody set. Null when unset — callers
 * hide the countdown rather than guess.
 */
export function revealMoment(
    event: Pick<LiveEvent, 'doors_open_at'>,
): { at: string; exact: boolean } | null {
    if (!event.doors_open_at) return null;
    const at = new Date(event.doors_open_at);
    if (Number.isNaN(at.getTime())) return null;
    return { at: at.toISOString(), exact: !isDateOnly(at) };
}

/**
 * A countdown, split for display. Clamped at zero — a reveal that has started
 * reads 0:00:00, never a negative. `days` carries whatever is over 24h so the
 * clock cells stay two digits.
 */
export function countdownParts(
    msRemaining: number,
): { days: number; hours: number; minutes: number; seconds: number; total: number } {
    const total = Math.max(0, Math.floor(msRemaining / 1000));
    return {
        total,
        days: Math.floor(total / 86_400),
        hours: Math.floor((total % 86_400) / 3600),
        minutes: Math.floor((total % 3600) / 60),
        seconds: total % 60,
    };
}

/**
 * When the night at the venue actually is — "Fri 4 Sept, 6–7pm".
 *
 * Sourced from doors_open_at/doors_close_at, which are the only fields on the
 * row that record it: the Door tab's counting window and the public event
 * time are the same two moments, so there is no second pair to drift against.
 *
 * Three shapes, in order:
 *   - both times on one day  -> "Fri 4 Sept, 6–7pm"
 *   - a start only           -> "Fri 4 Sept, 6pm"
 *   - a start at midnight    -> "Fri 4 Sept"
 *
 * That last one is not a special case for its own sake: the admin datetime
 * input defaults to 00:00, so midnight is the shape produced by picking a DAY
 * and not touching the time. Rendering it as "12am" would state something the
 * admin never said.
 *
 * Returns null when unset, and every caller must hide its row rather than
 * substitute the scoring window: guessing here would reintroduce exactly the
 * wrong-day problem that [[scoringLine]] exists to fix.
 */
export function eventNightLine(
    event: Pick<LiveEvent, 'doors_open_at' | 'doors_close_at'>,
): string | null {
    if (!event.doors_open_at) return null;
    const from = new Date(event.doors_open_at);
    const day = from.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const dateOnly = isDateOnly(from);

    const to = event.doors_close_at ? new Date(event.doors_close_at) : null;
    // A close time on a LATER day is a counting boundary, not an end time --
    // "doors close 00:00 on the 5th" means "the end of the 4th", so pairing it
    // with the start would render the nonsense "Fri 4 Sept, 12–12am".
    const sameDay = !!to && dayKey(to) === dayKey(from);

    if (dateOnly || !sameDay) return dateOnly ? day : `${day}, ${clockTime(from)}`;

    const a = clockTime(from);
    const b = clockTime(to!);
    // Drop the first meridiem when both share it: "6–7pm" is how a flyer
    // writes it, while "11am–1pm" needs both to stay unambiguous.
    const left = a.slice(-2) === b.slice(-2) ? a.slice(0, -2) : a;
    return `${day}, ${left}\u2013${b}`;
}

/**
 * Short status chip copy for the home card.
 *
 * Every branch names SCORING as the thing being counted to. A bare "IN 6
 * DAYS" reads as "the event is in 6 days" — and for a venue event the night
 * itself is a week the other side of that, so the chip was quietly pointing
 * at the wrong date in the same way the bare start date was.
 */
export function eventStatusChip(event: Pick<LiveEvent, 'status' | 'window_start_at'>): string {
    if (event.status !== 'scheduled') return 'LIVE NOW';
    const days = Math.max(0, Math.ceil((new Date(event.window_start_at).getTime() - Date.now()) / 86_400_000));
    if (days === 0) return 'SCORING TODAY';
    if (days === 1) return 'SCORING TOMORROW';
    return `SCORING IN ${days} DAYS`;
}

/** Promo media is one URL that may be a video or a still — route by extension. */
export function isVideoUrl(url: string | null | undefined): boolean {
    return !!url && /\.(mp4|m3u8|webm|mov)(\?|#|$)/i.test(url);
}

/**
 * The registration consent line. Shown whenever the event has a venue — even
 * before a booking_url exists, because the admin roster export exists from
 * day one and consent has to precede the share, not the link. One place so
 * the pitch stage and any future surface can never drift on the wording.
 */
export function consentLine(event: Pick<LiveEvent, 'venue'>): string | null {
    if (!event.venue?.name) return null;
    return `By registering, your name and email are shared with ${event.venue.name} to arrange your booking.`;
}

/**
 * Rank movement for a board row: the arrow direction and how many places.
 * null when there is nothing to draw — no reference rank (new to the board,
 * frozen results, league views) or no movement. Every surface (app board,
 * venue screen) keys off this so "▲ 2" means the same thing everywhere.
 */
export function rankMove(delta: number | null | undefined): { dir: 'up' | 'down'; places: number } | null {
    if (delta == null || !Number.isFinite(delta) || delta === 0) return null;
    return { dir: delta > 0 ? 'up' : 'down', places: Math.abs(Math.trunc(delta)) };
}

/**
 * Referral-gate progress for a board row: "3/3", "6/3" — the count is never
 * capped, over-completion is part of the cue. null when there is nothing to
 * draw: no gate on the event, or a row the server sent no count for (frozen
 * results, league views). One place so every surface agrees on the format.
 */
export function gateProgress(
    count: number | null | undefined,
    required: number | null | undefined
): { label: string; met: boolean } | null {
    if (count == null || required == null) return null;
    if (!Number.isFinite(count) || !Number.isFinite(required) || required <= 0) return null;
    const have = Math.max(0, Math.trunc(count));
    return { label: `${have}/${Math.trunc(required)}`, met: have >= required };
}

/**
 * The one sentence that says WHEN an invite pays. Two events can answer this
 * differently on the same screen, so it must never be hardcoded at the call
 * site — see `live_events.reward_referrals_on_signup` (2026-09-03).
 *
 * With the switch on the two sides are paid at DIFFERENT moments, which is the
 * whole reason this is a shared helper: the referrer is paid the instant the
 * code is used, while the friend still earns theirs by moving. Saying "you
 * each get +N" would be true about the amount and wrong about the timing, and
 * the timing is the thing people were asking about.
 */
export function inviteRewardLine(
    event: Pick<LiveEvent, 'invite_bonus_points' | 'reward_referrals_on_signup'>,
): string {
    const n = event.invite_bonus_points;
    return event.reward_referrals_on_signup
        ? `You get +${n} POWR the moment a friend joins with your code. They earn their +${n} on their first verified workout.`
        : `You each get +${n} POWR when a friend joins with your code and logs their first verified workout.`;
}
