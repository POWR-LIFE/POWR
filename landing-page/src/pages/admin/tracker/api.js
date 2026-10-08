/**
 * Tracker reads and writes. Every table is admin-only under RLS
 * (supabase/migrations/20261007200000_tracker.sql).
 */
import { supabase } from '../../../lib/supabase';
import { fetchAllRows, fetchRowsByIds } from '../../../lib/fetchAll';

const must = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// A missing table reads as "the migration isn't applied" rather than a crash.
export const isMissingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205';

export const loadIssues = () => fetchAllRows(() => supabase.from('tracker_issues').select('*'));

export async function createIssue(row) {
    return must(await supabase.from('tracker_issues').insert(row).select('*').single());
}

export async function updateIssue(id, patch) {
    return must(await supabase.from('tracker_issues').update(patch).eq('id', id).select('*').single());
}

export async function deleteIssue(id) {
    must(await supabase.from('tracker_issues').delete().eq('id', id));
}

// Admins, with the name the panel shows them by. admin_roles is readable to
// any signed-in user; profiles are admin-readable.
export async function loadAdmins() {
    const roles = must(await supabase.from('admin_roles').select('user_id'));
    const ids = roles.map(r => r.user_id);
    if (!ids.length) return [];
    const profiles = must(await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', ids));
    const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
    return ids.map(id => ({
        id,
        name: byId[id]?.display_name || byId[id]?.username || 'Admin',
        avatar_url: byId[id]?.avatar_url ?? null,
    })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadThread(issueId) {
    const [comments, activity] = await Promise.all([
        supabase.from('tracker_comments').select('*').eq('issue_id', issueId).order('created_at'),
        supabase.from('tracker_activity').select('*').eq('issue_id', issueId).order('created_at'),
    ]);
    return { comments: must(comments), activity: must(activity) };
}

export async function addComment(issueId, body) {
    return must(await supabase.from('tracker_comments').insert({ issue_id: issueId, body }).select('*').single());
}

export async function editComment(id, body) {
    return must(await supabase.from('tracker_comments').update({ body, edited_at: new Date().toISOString() }).eq('id', id).select('*').single());
}

export async function deleteComment(id) {
    must(await supabase.from('tracker_comments').delete().eq('id', id));
}

// The issue's thread in Slack #issues, once tracker-slack has posted it.
// Null when there isn't one (or the Slack migration isn't applied).
export async function slackThread(issueId) {
    const { data, error } = await supabase.from('tracker_slack_threads').select('permalink').eq('issue_id', issueId).maybeSingle();
    return error ? null : data?.permalink ?? null;
}

export async function loadRelations(issueId) {
    return must(await supabase.from('tracker_relations').select('*').or(`from_id.eq.${issueId},to_id.eq.${issueId}`));
}

export async function addRelation(fromId, toId, kind) {
    must(await supabase.from('tracker_relations').insert({ from_id: fromId, to_id: toId, kind }));
}

export async function removeRelation(rel) {
    must(await supabase.from('tracker_relations').delete()
        .eq('from_id', rel.from_id).eq('to_id', rel.to_id).eq('kind', rel.kind));
}

// ── Lookups for the "linked to" section ────────────────────────────────────

export async function membersByIds(ids) {
    if (!ids?.length) return [];
    return fetchRowsByIds(() => supabase.from('profiles').select('id, display_name, username, avatar_url'), ids);
}

export async function searchMembers(q) {
    const term = q.trim().replace(/[%,()]/g, '');
    if (term.length < 2) return [];
    return must(await supabase.from('profiles')
        .select('id, display_name, username, avatar_url')
        .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`)
        .limit(8));
}

export async function partnerById(id) {
    if (!id) return null;
    return must(await supabase.from('partners').select('id, name, category').eq('id', id).maybeSingle());
}

export async function searchPartners(q) {
    const term = q.trim().replace(/[%,()]/g, '');
    if (term.length < 2) return [];
    return must(await supabase.from('partners').select('id, name, category').ilike('name', `%${term}%`).order('name').limit(8));
}

export async function recentEvents() {
    return must(await supabase.from('live_events').select('id, name, slug, window_start_at')
        .order('window_start_at', { ascending: false, nullsFirst: false }).limit(40));
}

export async function ticketById(id) {
    if (!id) return null;
    return must(await supabase.from('support_tickets').select('*').eq('id', id).maybeSingle());
}

// ── Sprints (supabase/migrations/20261007220000_tracker_sprints.sql) ───────

// Null (not an error) when the sprints migration isn't applied yet, so the
// rest of the Tracker keeps working without it.
export async function loadSprints() {
    const { data, error } = await supabase.from('tracker_sprints').select('*').order('starts_on', { ascending: false });
    if (error) {
        if (isMissingTable(error)) return null;
        throw error;
    }
    return data;
}

export async function createSprint(row) {
    return must(await supabase.from('tracker_sprints').insert(row).select('*').single());
}

export async function updateSprint(id, patch) {
    return must(await supabase.from('tracker_sprints').update(patch).eq('id', id).select('*').single());
}

// Its issues go back to the backlog (sprint_id is "on delete set null").
export async function deleteSprint(id) {
    must(await supabase.from('tracker_sprints').delete().eq('id', id));
}

export async function startSprint(id) {
    return must(await supabase.rpc('tracker_start_sprint', { p_sprint: id }));
}

// Unfinished issues move to carryTo (a planned sprint), or the backlog when null.
export async function completeSprint(id, carryTo) {
    return must(await supabase.rpc('tracker_complete_sprint', { p_sprint: id, p_carry_to: carryTo ?? null }));
}

export async function setIssuesSprint(ids, sprintId) {
    if (!ids.length) return [];
    return must(await supabase.from('tracker_issues').update({ sprint_id: sprintId }).in('id', ids).select('*'));
}
