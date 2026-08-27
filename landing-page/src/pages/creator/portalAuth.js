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
        if (!verifyErr) markArrivedViaApp();
        return !verifyErr;
    } catch {
        return false;
    } finally {
        clearHandoffTicket();
    }
}

// While web login is closed (App.jsx AFFILIATE_WEB_LOGIN=false), the portal
// only opens for a session that was established by the app's handoff in THIS
// tab. sessionStorage is per-tab and dies with it — exactly the scope wanted.
const VIA_APP_KEY = 'powr_affiliate_via_app';
export function markArrivedViaApp() {
    try { window.sessionStorage.setItem(VIA_APP_KEY, '1'); } catch { /* private mode */ }
}
export function arrivedViaApp() {
    try { return window.sessionStorage.getItem(VIA_APP_KEY) === '1'; } catch { return false; }
}
