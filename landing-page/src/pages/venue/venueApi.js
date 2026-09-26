import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';

// Everything the gym portal reads or changes goes through gym_* SQL functions
// (each one checks the caller is staff of that gym, or an admin) or the
// manage-gym-staff edge function for logins and invites. Never raw tables:
// staff have no row-level access to member data, by design.

async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
}

export const fetchGymSummary = (partnerId) => rpc('gym_portal_summary', { p_partner_id: partnerId });
export const fetchGymInsights = (partnerId, weeks = 8) => rpc('gym_insights', { p_partner_id: partnerId, p_weeks: weeks });
export const setupGymScreens = (partnerId, slug) => rpc('gym_board_setup', { p_partner_id: partnerId, p_slug: slug });
// The Gym League as the big screen sees it, from the same function and the
// same credential (the board's display token), so the overview's standing is
// the standing on the wall.
export const fetchGymLeague = async (slug, token) => {
    const base = import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
    const res = await fetch(`${base}/functions/v1/gym-league?slug=${encodeURIComponent(slug)}&k=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`League unavailable (${res.status})`);
    return res.json();
};
export const updateGymScreens = (partnerId, patch) => rpc('gym_board_update', { p_partner_id: partnerId, p_patch: patch });

export const staffApi = (action, body = {}) => invokeFn('manage-gym-staff', { action, ...body });

// ── Events (gym-run, from templates) ────────────────────────────────────────
export const fetchEventTemplates = async () => {
    const { data, error } = await supabase.from('event_templates').select('*').eq('active', true).order('sort_order');
    if (error) throw new Error(error.message);
    return data ?? [];
};
export const fetchPointPresets = async () => {
    const { data, error } = await supabase.from('event_point_presets').select('*').eq('active', true).order('sort_order');
    if (error) throw new Error(error.message);
    return data ?? [];
};
export const fetchGymEvents = (partnerId) => rpc('gym_list_events', { p_partner_id: partnerId });
export const fetchGymEvent = (eventId) => rpc('gym_event_detail', { p_event_id: eventId });
export const createGymEvent = (partnerId, templateKey, fields) =>
    rpc('gym_create_event', { p_partner_id: partnerId, p_template_key: templateKey, p_fields: fields });
export const updateGymEvent = (eventId, fields) => rpc('gym_update_event', { p_event_id: eventId, p_fields: fields });
// The builder's live preview: the dates and house rules the server would set. Saves nothing.
// POWR partner rewards a gym can give as prizes; the winner's code is issued at the reveal.
export const fetchPrizeCatalogue = (partnerId) => rpc('gym_prize_catalogue', { p_partner_id: partnerId });
export const previewGymEvent = (partnerId, templateKey, fields) =>
    rpc('gym_preview_event', { p_partner_id: partnerId, p_template_key: templateKey, p_fields: fields });
export const publishGymEvent = (eventId) => rpc('gym_publish_event', { p_event_id: eventId });
export const withdrawGymEvent = (eventId) => rpc('gym_withdraw_event', { p_event_id: eventId });
export const deleteGymEvent = (eventId) => rpc('gym_delete_event', { p_event_id: eventId });
export const cancelGymEvent = (eventId) => rpc('gym_cancel_event', { p_event_id: eventId });
export const revealGymEvent = (eventId) => rpc('gym_reveal_event', { p_event_id: eventId });
export const scheduleGymReveal = (eventId, at) => rpc('gym_set_reveal_at', { p_event_id: eventId, p_reveal_at: at });
export const fetchGymEventBoard = (eventId) => rpc('gym_event_board', { p_event_id: eventId });
export const fetchGymEventRoster = (eventId) => rpc('gym_event_roster', { p_event_id: eventId });
export const disqualifyFromGymEvent = (eventId, userId, reason) =>
    rpc('gym_event_disqualify', { p_event_id: eventId, p_user_id: userId, p_reason: reason });
export const reinstateInGymEvent = (eventId, userId) => rpc('gym_event_reinstate', { p_event_id: eventId, p_user_id: userId });

// ── Event pushes (fixed POWR wording; the gym switches them on or off) ──────
export const fetchEventPushes = (eventId) => rpc('gym_event_push_status', { p_event_id: eventId });
export const setEventPush = (eventId, patch) => rpc('gym_event_set_push', { p_event_id: eventId, p_patch: patch });
export const sendStandingsNow = (eventId, dryRun) => rpc('gym_event_send_pulse', { p_event_id: eventId, p_dry_run: dryRun });

// ── Package (set by POWR; an owner can ask to switch) ───────────────────────
export const fetchGymPackage = (partnerId) => rpc('gym_package', { p_partner_id: partnerId });
export const requestGymPackage = (partnerId, pkg) => rpc('gym_request_package', { p_partner_id: partnerId, p_package: pkg });

// ── Member insights: anonymous numbers (Clash+), named opted-in members (Pro) ─
export const fetchMemberActivity = (partnerId, weeks = 12) => rpc('gym_member_activity', { p_partner_id: partnerId, p_weeks: weeks });
export const fetchMemberPeople = (partnerId) => rpc('gym_member_people', { p_partner_id: partnerId });

// ── Settings: the gym's own details ──────────────────────────────────────────
export const fetchGymProfile = (partnerId) => rpc('gym_profile', { p_partner_id: partnerId });
export const updateGymProfile = (partnerId, patch) => rpc('gym_update_profile', { p_partner_id: partnerId, p_patch: patch });
/** The caller's own Monday recap switch (each of the team chooses). */
export const setRecapEmail = (partnerId, on) => rpc('gym_set_recap_email', { p_partner_id: partnerId, p_on: on });

// ── The door on a finale night, and prizes handed over ───────────────────────
export const fetchEventDoor = (eventId) => rpc('gym_event_door', { p_event_id: eventId });
export const checkinAtDoor = (eventId, userId) => rpc('gym_event_checkin', { p_event_id: eventId, p_user_id: userId });
export const setPrizeHanded = (eventId, rank, handed) => rpc('gym_event_prize_handed', { p_event_id: eventId, p_rank: rank, p_handed: handed });

// ── The quiet-member nudge (Clash Pro): a dry run counts, then the send ──
export const nudgeQuietMembers = (partnerId, dryRun = true) => rpc('gym_nudge_quiet', { p_partner_id: partnerId, p_dry_run: dryRun });
