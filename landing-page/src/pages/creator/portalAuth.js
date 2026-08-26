import { supabase } from '../../lib/supabase';

/**
 * App → web handoff, browser side.
 *
 * The app opens powr.life/affiliate#h=<ticket>. The ticket rides in the URL
 * FRAGMENT so it never reaches Vercel's logs or a Referer header; the SPA
 * reads it here, trades it for a magic-link token hash at portal-handoff, and
 * verifies that into a normal web session. Single use + 90 s TTL server-side.
 */
export function readHandoffTicket() {
    if (typeof window === 'undefined') return null;
    const m = window.location.hash.match(/(?:^#|[#&])h=([0-9a-f]{64})(?:&|$)/);
    return m ? m[1] : null;
}

export function clearHandoffTicket() {
    if (typeof window === 'undefined') return;
    const url = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
}

/** Returns true when a session was established. Never throws. */
export async function completeHandoff(ticket) {
    try {
        const { data, error } = await supabase.functions.invoke('portal-handoff', { body: { ticket } });
        if (error || !data?.ok || !data.token_hash) return false;
        const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: data.type || 'magiclink' });
        return !verifyErr;
    } catch {
        return false;
    } finally {
        clearHandoffTicket();
    }
}
