// Settings, Support, the setup page and sign-in: Peakform Nutrition's team
// (Alex plus two colleagues, two setup links still unused) and Alex's support
// tickets (one waiting on POWR, one answered, one closed).
//
// The setup page and sign-in are signed out (portal 'none'), so they get no
// portal fixtures; their shots import SETUP_FIXTURES from here instead.
import { BRAND, BRAND_USER, daysFromNow } from '../world.mjs';

// Unused setup links. The token is shown in the panel as part of the link, so
// it is a plain placeholder, never something that looks like a real secret.
export const INVITE_TOKEN = 'docs-setup-link';

export const TEAM = [
    // Alex: the login the shots are signed in with.
    { id: 'brand-user-1', user_id: BRAND_USER.id, created_at: daysFromNow(-48), email: BRAND_USER.email, last_sign_in: daysFromNow(0), confirmed: true },
    { id: 'brand-user-2', user_id: '6f1d2c3b-0000-4000-8000-00000000c002', created_at: daysFromNow(-41), email: 'jordan@peakform.example', last_sign_in: daysFromNow(-1), confirmed: true },
    // Re-linked by POWR five days ago (the answered ticket below).
    { id: 'brand-user-3', user_id: '6f1d2c3b-0000-4000-8000-00000000c003', created_at: daysFromNow(-30), email: 'casey@peakform.example', last_sign_in: daysFromNow(-4), confirmed: true },
];

export const INVITES = [
    { id: 'brand-invite-2', created_at: daysFromNow(-2, 10), token: INVITE_TOKEN, email: 'riley@peakform.example', url: `https://powr.life/partner/setup/${INVITE_TOKEN}` },
    { id: 'brand-invite-1', created_at: daysFromNow(-9, 15), token: `${INVITE_TOKEN}-2`, email: null, url: `https://powr.life/partner/setup/${INVITE_TOKEN}-2` },
];

/** manage-partner-user: the team list, invites, and the setup page's check. */
export const managePartnerUser = (b) => {
    switch (b.action) {
        case 'validate_invite':
            return { ok: true, brand: { name: BRAND.name, logo_url: BRAND.logo_url } };
        case 'redeem_invite':
            return { ok: true };
        case 'list':
            return { ok: true, users: TEAM, invites: INVITES };
        case 'create_invite':
            return { ok: true, token: INVITE_TOKEN, url: `https://powr.life/partner/setup/${INVITE_TOKEN}`, emailed: !!b.email, reused: false };
        case 'revoke_invite':
        case 'remove':
            return { ok: true };
        default:
            return { ok: true };
    }
};

/** For signed-out shots (setup page, sign-in), which load no portal fixtures. */
export const SETUP_FIXTURES = { fn: { 'manage-partner-user': managePartnerUser } };

// ── Support tickets (support_tickets, the signed-in user's own) ─────────────
export const TICKETS = [
    {
        id: 'ticket-3',
        user_id: BRAND_USER.id,
        email: BRAND_USER.email,
        brand_name: BRAND.name,
        category: 'partner_rewards',
        subject: 'Can our listing update go live before Friday?',
        message: 'We sent a listing update yesterday that adds bundles to the offer. Any chance it can be approved before our Friday newsletter goes out? Happy to change the wording if that helps.',
        status: 'open',
        admin_reply: null,
        created_at: daysFromNow(-0.12),
        updated_at: daysFromNow(-0.12),
    },
    {
        id: 'ticket-2',
        user_id: BRAND_USER.id,
        email: BRAND_USER.email,
        brand_name: BRAND.name,
        category: 'partner_account',
        subject: 'Adding Casey back to our team',
        message: 'We removed Casey from the team by mistake. When she opens a new setup link it says an account with this email already exists. Can you add her back?',
        status: 'resolved',
        admin_reply: 'Hi Alex, all sorted. Casey’s login is linked to Peakform Nutrition again, so she can sign in with her usual email and password. There’s nothing else to do on your side.',
        created_at: daysFromNow(-5.3),
        updated_at: daysFromNow(-5.1),
    },
    {
        id: 'ticket-1',
        user_id: BRAND_USER.id,
        email: BRAND_USER.email,
        brand_name: BRAND.name,
        category: 'partner_setup',
        subject: 'Format for our first code upload',
        message: 'We have 300 codes from our shop ready to go. Should the file be one code per line, or does it need a header row?',
        status: 'closed',
        admin_reply: 'Either works. Paste the codes or upload the CSV on Promo Codes, and there’s a template to download there if you’d like a starting point.',
        created_at: daysFromNow(-47.4),
        updated_at: daysFromNow(-47.2),
    },
];

export default {
    rest: {
        support_tickets: TICKETS,
    },
    fn: {
        'manage-partner-user': managePartnerUser,
    },
};
