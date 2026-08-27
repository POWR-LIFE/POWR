import { supabase } from '@/lib/supabase';

/**
 * Earned creator invite (Jamie, 2026-08-26): a member who has brought
 * `creator_invite_threshold` people in (converted referrals — verified first
 * workouts, as referrer, inside `creator_invite_window_days`) is ASKED on Home
 * whether they want to be a POWR Creator. Tapping files a request an admin
 * approves. Nothing here grants anything — the server decides eligibility and
 * the admin decides membership.
 */
export interface CreatorInviteEligibility {
    program_enabled: boolean;
    already_creator: boolean;
    converted: number;
    threshold: number;
    window_days: number;
    eligible: boolean;
    request_status: 'pending' | 'approved' | 'declined' | null;
    request_id: string | null;
    requested_at: string | null;
    decided_at: string | null;
}

export async function fetchCreatorInviteEligibility(): Promise<CreatorInviteEligibility | null> {
    const { data, error } = await supabase.rpc('creator_invite_eligibility');
    if (error) throw error;
    return (data as CreatorInviteEligibility | null) ?? null;
}

export async function requestCreatorInvite(): Promise<void> {
    const { error } = await supabase.rpc('request_creator_invite');
    if (error) throw error;
}

export type CreatorInviteCardState = 'hidden' | 'eligible' | 'pending' | 'approved';

/** How long the "you're in" card lingers on Home after approval (ms). */
export const APPROVED_CARD_TTL_MS = 14 * 86_400_000;

/**
 * What the Home card shows. Pure so it's testable; the order matters:
 *  - approved + linked → a short-lived "open your portal" card, then nothing
 *    (the Settings row is the permanent home)
 *  - already a creator by any other route → nothing
 *  - pending → "request sent"
 *  - declined → nothing (quiet; server re-opens eligibility after 30 days)
 *  - eligible → the ask
 */
export function creatorInviteCardState(
    e: CreatorInviteEligibility | null | undefined,
    now: number = Date.now(),
): CreatorInviteCardState {
    if (!e || !e.program_enabled) return 'hidden';
    if (e.request_status === 'approved' && e.already_creator) {
        const decided = e.decided_at ? Date.parse(e.decided_at) : NaN;
        return Number.isFinite(decided) && now - decided < APPROVED_CARD_TTL_MS ? 'approved' : 'hidden';
    }
    if (e.already_creator) return 'hidden';
    if (e.request_status === 'pending') return 'pending';
    if (e.request_status === 'declined') return 'hidden';
    return e.eligible ? 'eligible' : 'hidden';
}
