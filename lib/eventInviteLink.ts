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
    return `https://powr.life${eventInvitePath(slug, referralCode)}`;
}

/**
 * The same invite, as the path under powr.life. This is what a published
 * share card stores as its `app_path`, so a friend who taps the card's link
 * preview lands on THIS event rather than the generic smart-link.
 */
export function eventInvitePath(slug: string, referralCode?: string | null): string {
    const base = `/app?to=league&event=${encodeURIComponent(slug)}`;
    return referralCode ? `${base}&ref=${encodeURIComponent(referralCode)}` : base;
}

/**
 * The text an invite travels as — share sheet AND clipboard. The link's
 * `ref=` only survives when the app is already installed; a friend who
 * installs from the store arrives with nothing but what they can read, so
 * the code is always spelled out next to the link. Copy must hand over the
 * same text as Share, or a pasted invite silently loses the code.
 */
export function eventInviteMessage(opts: {
    eventName: string;
    link: string;
    code?: string | null;
    bonusPoints?: number | null;
}): string {
    const { eventName, link, code, bonusPoints } = opts;
    const lines = [`Join me for ${eventName} on POWR 💪`];
    if (code) lines.push(inviteCodeLine(code, bonusPoints));
    lines.push(link);
    return lines.join('\n');
}

/**
 * The sentence that hands over the code — shared by the event invite and the
 * prize card so the promise ("we both earn…") is worded once.
 */
export function inviteCodeLine(code: string, bonusPoints?: number | null): string {
    return bonusPoints && bonusPoints > 0
        ? `Sign up with my code ${code} — we both earn +${bonusPoints} POWR after your first workout.`
        : `Sign up with my code ${code}.`;
}
