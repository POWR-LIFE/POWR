/**
 * The link an event invite (share sheet + in-app QR) encodes. Mirrors the
 * admin/promo registration QR contract in
 * landing-page/src/lib/eventRegisterUrl.js — same `?to=league&event=<slug>`
 * smart-link, so scanning either lands on the League tab pinned to that
 * event. app.html forwards params beyond `to` into the deep link; `ref=`
 * rides along for referral attribution (code-first — the share message still
 * spells the code out for signup entry).
 */
export function eventInviteLink(slug: string, referralCode?: string | null): string {
    const base = `https://powr.life/app?to=league&event=${encodeURIComponent(slug)}`;
    return referralCode ? `${base}&ref=${encodeURIComponent(referralCode)}` : base;
}
