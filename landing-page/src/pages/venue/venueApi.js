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
