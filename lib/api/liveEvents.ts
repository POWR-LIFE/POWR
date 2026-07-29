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

export type LiveEventViewer = {
    eligible: boolean;
    joined: boolean;
    disqualified: boolean;
};

export type LiveEventPrize = { rank: number; label: string };

export type LiveEvent = {
    id: string;
    slug: string;
    name: string;
    status: 'scheduled' | 'live' | 'locked' | 'revealed' | 'settled';
    scope: 'global' | 'opt_in';
    window_start_at: string;
    window_end_at: string;
    lock_at: string | null;
    is_locked: boolean;
    revealed_at: string | null;
    prizes: LiveEventPrize[];
    board_size: number;
    invite_bonus_points: number;
    invite_milestone_n: number;
    invite_milestone_bonus: number;
    conversion_deadline_at: string | null;
    viewer: LiveEventViewer;
};

export type InviteFriend = {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    converted: boolean;
    converted_at: string | null;
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
    } | null;
};

export async function fetchActiveLiveEvent(): Promise<LiveEvent | null> {
    const { data, error } = await supabase.rpc('get_active_live_event');
    if (error) return null;
    return (data as LiveEvent | null) ?? null;
}

export async function fetchInviteProgress(): Promise<InviteProgress | null> {
    const { data, error } = await supabase.rpc('get_my_invite_progress');
    if (error) return null;
    return (data as InviteProgress | null) ?? null;
}

/** Opt-in scope only; server re-checks eligibility. Returns the updated viewer state. */
export async function joinLiveEvent(eventId: string): Promise<LiveEventViewer | null> {
    const { data, error } = await supabase.rpc('join_live_event', { p_event_id: eventId });
    if (error) return null;
    return (data as LiveEventViewer | null) ?? null;
}
