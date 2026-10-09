// Getting in, Settings, the Package page and the join poster: the portal
// logins (manage-gym-staff), and the writes those pages make. Reads the
// Overview shares (gym_profile, gym_team, gym_tickets) live in gym-core.
//
// Who can sign in to Northpoint's portal: Sam Carter and Nadia Brooks
// (owners), Jordan Hale and Lena Marsh (team, also on the gym's page in the
// app). Tom Reyes has an emailed invite waiting, and Sam made a setup link
// today.
import { GYM, OWNER, uid } from '../world.mjs';
import { PROFILE, TEAM } from './gym-core.mjs';
import { PRO } from './gym-base.mjs';

const DAY = 864e5;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();

/** The link a new setup link shows. Plain words, so it never reads as a real key. */
export const SETUP_URL = 'https://powr.life/venue/setup/docs-setup-link';

const LOGINS = [
    { user_id: OWNER.id, role: 'owner', added_at: ago(131), email: OWNER.email, name: OWNER.name, username: null, avatar_url: null, last_sign_in: ago(0, 1) },
    { user_id: uid('login', 2), role: 'owner', added_at: ago(131), email: 'nadia@northpoint.example', name: 'Nadia Brooks', username: null, avatar_url: null, last_sign_in: ago(4) },
    { user_id: uid('login', 3), role: 'staff', added_at: ago(96), email: 'jordan@northpoint.example', name: 'Jordan Hale', username: null, avatar_url: null, last_sign_in: ago(1) },
    { user_id: uid('login', 4), role: 'staff', added_at: ago(40), email: 'lena@northpoint.example', name: 'Lena Marsh', username: null, avatar_url: null, last_sign_in: ago(6) },
];
const INVITES = [
    { id: uid('invite', 2), role: 'staff', email: null, created_at: ago(0, 0.2), expires_at: ahead(14) },
    { id: uid('invite', 1), role: 'staff', email: 'tom@northpoint.example', created_at: ago(2), expires_at: ahead(12) },
];

function staff(b) {
    switch (b.action) {
        // The setup page, opened from Sam's email.
        case 'validate_invite': return { ok: true, role: 'owner', gym: { name: GYM.name, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg } };
        case 'accept_invite': return { ok: true, partner_id: GYM.id };
        case 'redeem_invite': return { ok: true };
        case 'list': return { ok: true, role: 'owner', can_manage: true, team: LOGINS, invites: INVITES };
        case 'create_invite': return { ok: true, id: uid('invite', 3), url: SETUP_URL, token: 'docs-setup-link', expires_at: ahead(14), emailed: !!b.email, email_error: null };
        case 'revoke_invite': case 'remove': return { ok: true };
        default: return { ok: true };
    }
}

const team = (members = TEAM) => ({ can_edit: true, members });

export default {
    rpc: {
        gym_update_profile: ({ p_patch }) => ({ ...PROFILE, ...(p_patch ?? {}) }),
        gym_set_recap_email: ({ p_on }) => !!p_on,
        gym_set_drift_email: ({ p_on }) => !!p_on,
        gym_request_package: ({ p_package }) => ({ ...PRO, requested: p_package, requested_at: new Date().toISOString() }),
        gym_submit_ticket: ({ p_subject, p_message }) => [{
            id: uid('ticket', 9), category: 'gym_help', subject: p_subject, message: p_message, status: 'open', reply: null,
            email: OWNER.email, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }],
        // The trainer editor on the Overview's app page.
        gym_save_team_member: ({ p_member_id, p_fields }) => {
            const id = p_member_id ?? '6f1d2c3b-0000-4000-8000-0000000e0099';
            const members = p_member_id
                ? TEAM.map((m) => (m.id === p_member_id ? { ...m, ...p_fields } : m))
                : [...TEAM, { id, experience: '', specialties: [], bio: '', booking_url: null, profile_url: null, photo_url: null, active: true, sort_order: TEAM.length + 1, ...p_fields }];
            return { ...team(members), saved_id: id };
        },
        gym_delete_team_member: ({ p_member_id }) => team(TEAM.filter((m) => m.id !== p_member_id)),
        gym_order_team: () => team(),
    },
    fn: {
        'manage-gym-staff': staff,
    },
};
