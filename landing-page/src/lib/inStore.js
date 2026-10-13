// In-store redemption: the portal's calls into the in-store RPCs
// (supabase/migrations/20261013120100_in_store_redemption.sql) plus the
// labels every in-store surface shares. The code maths lives in
// shared/inStore.ts so the app, this site and Postgres agree.
import { supabase } from './supabase';

// RPC errors carry a sentence written for people (see the migration's
// `raise exception` messages). Surface it as-is.
async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message || 'Something went wrong');
    return data;
}

// Admin preview passes the brand being previewed; brand users are forced to
// their own brand server-side whatever is sent.
export const fetchInStoreOverview = (brand) => rpc('partner_in_store_overview', { p_brand: brand ?? null });

export const saveSite = (brand, site) => rpc('partner_save_site', {
    p_brand: brand ?? null,
    p_site_id: site.id ?? null,
    p_name: site.name,
    p_address: site.address ?? null,
    p_lat: site.lat,
    p_lng: site.lng,
    p_radius_m: site.radius_m ?? 75,
});
export const archiveSite = (brand, siteId) => rpc('partner_archive_site', { p_brand: brand ?? null, p_site_id: siteId });
export const rotateStand = (brand, siteId) => rpc('partner_rotate_stand', { p_brand: brand ?? null, p_site_id: siteId });

export const createStaff = (brand, name, siteId) => rpc('partner_create_staff', { p_brand: brand ?? null, p_name: name, p_site_id: siteId ?? null });
export const reissueStaff = (brand, staffId) => rpc('partner_reissue_staff', { p_brand: brand ?? null, p_staff_id: staffId });
export const revokeStaff = (brand, staffId) => rpc('partner_revoke_staff', { p_brand: brand ?? null, p_staff_id: staffId });

export const setRewardInStore = (brand, rewardId, s) => rpc('partner_set_reward_in_store', {
    p_brand: brand ?? null,
    p_reward_id: rewardId,
    p_where: s.where,
    p_check: s.check,
    p_requires_stand: !!s.requires_stand,
    p_ask_spend: s.ask_spend !== false,
    p_window_minutes: s.window_minutes ?? 5,
    p_barcode_format: s.barcode_format ?? 'code128',
    p_site_ids: s.site_ids && s.site_ids.length ? s.site_ids : null,
});

export const fetchInStoreReport = (brand, days) => rpc('partner_in_store_report', { p_brand: brand ?? null, p_days: days });

// ── Staff scan page ─────────────────────────────────────────────────────────
// `token` is the staff member's personal link token, or null for a signed-in
// portal user.
export const scanSession = (token) => rpc('in_store_scan_session', { p_token: token ?? null });
export const scanCheck = (token, siteId, q) => rpc('in_store_scan_check', {
    p_token: token ?? null,
    p_site_id: siteId ?? null,
    p_voucher_id: q.voucherId ?? null,
    p_proof: q.proof ?? null,
    p_typed_code: q.code ?? null,
});
export const scanConfirm = (token, siteId, voucherId, ticket, spendPence) => rpc('in_store_scan_confirm', {
    p_token: token ?? null,
    p_site_id: siteId ?? null,
    p_voucher_id: voucherId,
    p_ticket: ticket,
    p_spend_pence: Number.isFinite(spendPence) ? spendPence : null,
});
export const scanToday = (token, siteId) => rpc('in_store_scan_today', { p_token: token ?? null, p_site_id: siteId ?? null });
export const kioskStand = (token, siteId) => rpc('in_store_kiosk', { p_token: token ?? null, p_site_id: siteId ?? null });

// The staff link: the token rides in the fragment so it never reaches a
// server log or a Referer header.
export const staffLink = (token) => `${window.location.origin}/scan#k=${token}`;
export const scanPageUrl = () => `${window.location.origin}/scan`;

// ── Shared labels ───────────────────────────────────────────────────────────

export const WHERE_OPTIONS = [
    { value: 'online', label: 'Online', blurb: 'A code or link for your website. Works today.' },
    { value: 'in_store', label: 'In store', blurb: 'A live voucher members show at your till.' },
    { value: 'both', label: 'Both', blurb: 'One reward. Members use it either way.' },
];

export const CHECK_OPTIONS = [
    {
        value: 'staff_scan', label: 'Staff scan', recommended: true,
        blurb: 'Staff scan the voucher on powr.life/scan, from any phone or a tablet at the till.',
        reports: 'Confirmed', tone: 'good',
    },
    {
        value: 'look', label: 'Look at the screen',
        blurb: 'Staff check the live voucher and swipe it on the member’s phone. Nothing to set up.',
        reports: 'Shown, not confirmed', tone: 'warn',
    },
    {
        value: 'till_barcode', label: 'Till barcode',
        blurb: 'Members show one of your own barcodes and your till scans it. For chains.',
        reports: 'Confirmed from your till report', tone: 'good',
    },
];

export const BARCODE_FORMATS = [
    { value: 'ean13', label: 'EAN-13' },
    { value: 'code128', label: 'Code 128' },
    { value: 'qr', label: 'QR' },
];

export const describeInStore = (r) => {
    if (!r || r.where === 'online') return 'Online only';
    const where = r.where === 'both' ? 'Online + in store' : 'In store';
    const how = CHECK_OPTIONS.find(o => o.value === r.check)?.label ?? '';
    return `${where} · ${how}`;
};

export const formatPence = (p) => `£${((p ?? 0) / 100).toFixed(2)}`;
export const formatPounds = (p) => {
    const v = (p ?? 0) / 100;
    return `£${v >= 1000 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(v % 1 ? 2 : 0)}`;
};

export function timeAgoShort(iso) {
    if (!iso) return null;
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : `${d} days ago`;
}

// Google Maps share links and pasted "lat, lng" pairs -> { lat, lng }.
// Regex only: these are pasted strings, not navigable URLs.
export function parseCoordinates(text) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const patterns = [
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
        /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
        /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
    ];
    for (const re of patterns) {
        const m = re.exec(t);
        if (m) {
            const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
        }
    }
    return null;
}
