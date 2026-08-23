import { supabase } from '@/lib/supabase';

/**
 * Live events (points weeks) — see context/LIVE_EVENTS_PLAN.md.
 *
 * The app never hardcodes an event: get_active_live_event() returns the one
 * current event (or null), fully configured server-side. Scores only ever
 * arrive through get_event_leaderboard, which enforces the locked-board blur
 * on the server — when `is_locked` is true there is nothing score-shaped in
 * the payload, by design. Don't try to fill the gap client-side.
 */

/** Referral entry-gate progress. 'signups' counts friends who entered the
 *  viewer's code at onboarding; 'conversions' counts those whose first
 *  verified workout has landed. */
export type LiveEventGate = {
    required: number;
    counting: 'signups' | 'conversions';
    count: number;
    met: boolean;
};

/** The viewer's venue-booking state. `confirmed` derives server-side from the
 *  venue's uploaded attendee export by email match — a positive-only signal:
 *  false means "not in the export we have", never "did not book" (they may
 *  have booked under a different email). Don't write copy that asserts the
 *  negative. */
export type LiveEventBookingState = {
    /** When this user first tapped through to the booking site. */
    opened_at: string | null;
    confirmed: boolean;
};

export type LiveEventViewer = {
    eligible: boolean;
    joined: boolean;
    disqualified: boolean;
    /** Null/absent when the event has no entry gate. */
    gate?: LiveEventGate | null;
    /** Absent only from pre-migration payloads — treat missing as unopened. */
    booking?: LiveEventBookingState;
};

/** One row of `live_events.prizes` (jsonb, admin-authored). `image_url` is a
 *  public reward-images URL added by the admin Prizes editor — optional, and
 *  older events simply lack the key. */
export type LiveEventPrize = { rank: number; label: string; image_url?: string | null };

/** Venue branding for promo surfaces. `logo_bg` is 'white' | 'dark' — chip the
 *  logo on anything ≠ 'dark' (matches the landing promo page's convention). */
export type LiveEventVenue = {
    /** partners.id — the key Discover uses to focus a venue on the map.
     *  Absent on pre-20260821 payloads, so treat it as optional. */
    id?: string | null;
    name: string;
    logo_url: string | null;
    logo_bg: string | null;
    /** Postal address as entered in the partner record. Free-text and often
     *  messy, so the card shows the venue NAME and keeps this for a11y. */
    address?: string | null;
    /** locations[0] — a venue partner is single-location by construction.
     *  Null when the partner has no geometry yet; the card's map link is
     *  hidden rather than sending someone to the middle of the ocean. */
    lat?: number | null;
    lng?: number | null;
};

export type LiveEvent = {
    id: string;
    slug: string;
    name: string;
    /** Optional uploaded logo for the POWR side of the card's partnership
     *  lockup (venue logo · divider · this). White-on-transparent expected —
     *  it renders raw on the artwork. Null = the bundled white POWR mark. */
    logo_url: string | null;
    /** Hide the name text on the card — the lockup alone (rendered larger)
     *  carries the identity. The name still exists for sheets/boards/a11y. */
    logo_only: boolean;
    status: 'scheduled' | 'live' | 'locked' | 'revealed' | 'settled';
    scope: 'global' | 'opt_in';
    window_start_at: string;
    window_end_at: string;
    lock_at: string | null;
    /** The night at the venue. Nothing else on the row records it — the Door
     *  tab's counting window and the public event time are the same fact, so
     *  this field carries both. Null until an admin sets it, which is why
     *  every surface treats "no doors time" as "don't claim a date". */
    doors_open_at?: string | null;
    doors_close_at?: string | null;
    is_locked: boolean;
    revealed_at: string | null;
    prizes: LiveEventPrize[];
    board_size: number;
    invite_bonus_points: number;
    invite_milestone_n: number;
    invite_milestone_bonus: number;
    conversion_deadline_at: string | null;
    /** Marketing fields set in the admin editor's "Promo page" group — shared
     *  with powr.life/promo/<slug> so one upload feeds every surface. */
    promo_headline: string | null;
    promo_media_url: string | null;
    /** Admin-authored list of the rules a registrant agrees to. Optional only
     *  because pre-migration payloads lack it — consumers read `rules ?? []`. */
    rules?: string[];
    /** The venue's external booking page (third-party system). Null/absent
     *  hides every booking surface; the admin sets it when bookings open. May
     *  contain {email}/{name} placeholders — see lib/eventBookingLink.ts. */
    booking_url?: string | null;
    venue: LiveEventVenue | null;
    /** True when this is a draft served only to the admin-listed preview
     *  accounts (status is simulated as scheduled/live for them). */
    is_preview?: boolean;
    viewer: LiveEventViewer;
};

export type InviteFriend = {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    converted: boolean;
    converted_at: string | null;
    /** When they signed up with the code. Optional only because
     *  pre-migration payloads lack it. */
    created_at?: string | null;
    /** This referral is attributed to the current event. */
    for_event?: boolean;
    /** THE flag the list is sorted and labelled by: does this friend count
     *  toward the number on the card right now? The server computes it from
     *  whichever basis the event actually uses (entry gate, or the invite
     *  milestone when there is no gate), so the flags always sum to the
     *  count — never re-derive it on the client. */
    counts_for_event?: boolean;
};

export type InviteProgress = {
    friends: InviteFriend[];
    total: number;
    converted_total: number;
    event: {
        event_id: string;
        invite_bonus_points: number;
        milestone_n: number;
        milestone_bonus: number;
        converted_for_event: number;
        milestone_paid: boolean;
        entry_gate_n: number;
        entry_gate_counting: 'signups' | 'conversions';
        gate_count: number;
        /** True when the event has no gate too — safe to key copy on directly. */
        gate_met: boolean;
    } | null;
};

export type EventBoardEntry = {
    rank: number;
    user_id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    is_pro: boolean;
    points: number;
    prize_label?: string | null;
};

export type EventLeaderboard = {
    event_id: string;
    status: LiveEvent['status'];
    is_locked: boolean;
    /** True on preview-forced payloads (draft + previewer): the board may
     *  carry SAMPLE rows under sentinel 00000000-0000-4000-8000-* user_ids —
     *  render them, never treat them as tappable profiles. */
    is_preview?: boolean;
    /** True while the board is live but this viewer hasn't met the referral
     *  entry gate — the payload carries nothing score-shaped, same discipline
     *  as the locked blur. viewer.gate has their progress. */
    is_gated?: boolean;
    /** Present only while the board is live and visible — absence IS the blur. */
    standings?: EventBoardEntry[];
    /** Present only after reveal: the frozen winners snapshot. */
    results?: EventBoardEntry[];
    viewer: LiveEventViewer & { rank?: number; points?: number; prize_label?: string | null };
};

/**
 * The board states a previewer can force from the app, in the order a tester
 * walks them. 'auto' is the real thing under the simulated status — the only
 * value a non-previewer can ever get, whatever they send.
 */
export const BOARD_PREVIEW_STATES = ['auto', 'gated', 'live', 'locked', 'revealed'] as const;
export type BoardPreviewState = (typeof BOARD_PREVIEW_STATES)[number];

/**
 * `previewState` is honoured server-side ONLY for a previewer on a draft, and
 * falls back to the event's admin-set column when omitted — so passing it is
 * safe on any event and the admin control stays the default.
 */
export async function fetchEventLeaderboard(
    eventId: string,
    previewState?: BoardPreviewState | null,
): Promise<EventLeaderboard | null> {
    const { data, error } = await supabase.rpc('get_event_leaderboard', {
        p_event_id: eventId,
        p_preview_state: previewState ?? null,
    });
    if (error) return null;
    return (data as EventLeaderboard | null) ?? null;
}

export async function fetchActiveLiveEvent(): Promise<LiveEvent | null> {
    const { data, error } = await supabase.rpc('get_active_live_event');
    if (error) return null;
    return (data as LiveEvent | null) ?? null;
}

/** A specific event by slug (promo-page QR deep link). Draft/archived → null. */
export async function fetchLiveEventBySlug(slug: string): Promise<LiveEvent | null> {
    const { data, error } = await supabase.rpc('get_live_event', { p_slug: slug });
    if (error) return null;
    return (data as LiveEvent | null) ?? null;
}

export async function fetchInviteProgress(): Promise<InviteProgress | null> {
    const { data, error } = await supabase.rpc('get_my_invite_progress');
    if (error) return null;
    return (data as InviteProgress | null) ?? null;
}

/** Preview drafts only: remove own registration so the flow can be re-tested.
 *  The server hard-rejects anything that isn't a draft the caller previews —
 *  there is deliberately no general "leave event" path. */
export async function resetLiveEventPreview(eventId: string): Promise<LiveEventViewer | null> {
    const { data, error } = await supabase.rpc('reset_live_event_preview', { p_event_id: eventId });
    if (error) return null;
    return (data as LiveEventViewer | null) ?? null;
}

/** Opt-in scope only; server re-checks eligibility. Returns the updated viewer
 *  state. THROWS on failure — the server's P0001 messages are written for
 *  humans ("Your account was created after the eligibility cutoff") and the
 *  register flow surfaces them verbatim instead of a generic shrug. */
export async function joinLiveEvent(eventId: string): Promise<LiveEventViewer | null> {
    const { data, error } = await supabase.rpc('join_live_event', { p_event_id: eventId });
    if (error) throw error;
    return (data as LiveEventViewer | null) ?? null;
}

/** Stamp that the viewer tapped through to the venue booking site. Set-if-null
 *  server-side (first open is the funnel fact) and deliberately fire-and-forget
 *  here: the stamp must never stand between a user and the booking page. */
export async function markEventBookingOpened(eventId: string): Promise<void> {
    await supabase.rpc('mark_event_booking_opened', { p_event_id: eventId }).then(
        () => undefined,
        () => undefined,
    );
}
