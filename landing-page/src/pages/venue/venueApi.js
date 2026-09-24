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
