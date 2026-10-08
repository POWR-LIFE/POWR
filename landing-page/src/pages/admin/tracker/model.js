/**
 * Tracker vocabulary and the pure helpers the board, list and drawer share.
 * The database checks the same keys (supabase/migrations/20261007200000_tracker.sql);
 * add a key there before adding it here.
 */
import { EDGE_FUNCTIONS, SURFACES, areaOf, surfaceOf } from './taxonomy';

// The flow, left to right on the board. Work isn't finished at merged, or at
// live: an OTA nobody has proven on a phone is how things went wrong before.
export const STATUSES = [
    { key: 'triage',   label: 'Triage',      color: '#888888', hint: 'New. Nobody has sorted it yet.' },
    { key: 'backlog',  label: 'Backlog',     color: '#A3A3A3', hint: 'Real, not scheduled.' },
    { key: 'next',     label: 'Up next',     color: '#60A5FA', hint: 'Picked for the next stretch of work.' },
    { key: 'doing',    label: 'In progress', color: '#0EA5E9', hint: 'Someone is on it.' },
    { key: 'review',   label: 'In review',   color: '#8B5CF6', hint: 'PR open.' },
    { key: 'merged',   label: 'Merged',      color: '#F97316', hint: 'On main, but nobody has it. Needs an OTA, build, deploy or migration.' },
    { key: 'live',     label: 'Live',        color: '#CBB800', hint: 'Shipped. Not yet proven on a device, in the field or in the data.' },
    { key: 'verified', label: 'Verified',    color: '#10B981', hint: 'Proven working where it matters.' },
];
export const CLOSED_STATUS = { key: 'closed', label: 'Closed', color: '#555555', hint: 'Out of the flow.' };
export const ALL_STATUSES = [...STATUSES, CLOSED_STATUS];
export const statusOf = (key) => ALL_STATUSES.find(s => s.key === key) ?? STATUSES[0];

export const RESOLUTIONS = [
    { key: 'done', label: 'Done' },
    { key: 'wont_do', label: "Won't do" },
    { key: 'duplicate', label: 'Duplicate' },
    { key: 'cant_repro', label: "Can't reproduce" },
];

export const TYPES = [
    { key: 'bug',           label: 'Bug',           color: '#F43F5E' },
    { key: 'incident',      label: 'Incident',      color: '#DC2626' },
    { key: 'feature',       label: 'Feature',       color: '#8B5CF6' },
    { key: 'improvement',   label: 'Improvement',   color: '#0EA5E9' },
    { key: 'task',          label: 'Task',          color: '#64748B' },
    { key: 'debt',          label: 'Tech debt',     color: '#A16207' },
    { key: 'investigation', label: 'Investigation', color: '#14B8A6' },
];
export const typeOf = (key) => TYPES.find(t => t.key === key) ?? TYPES[0];

export const PRIORITIES = [
    { value: 0, label: 'P0', name: 'Now',       color: '#DC2626', hint: 'Points or money wrong, a crash loop, member data exposed, an event night at risk.' },
    { value: 1, label: 'P1', name: 'This week', color: '#F97316', hint: 'Members or gyms feel it. Fix before the next release.' },
    { value: 2, label: 'P2', name: 'Normal',    color: '#60A5FA', hint: 'Worth doing. Goes in order.' },
    { value: 3, label: 'P3', name: 'Someday',   color: '#A3A3A3', hint: 'Nice to have.' },
];
export const priorityOf = (value) => PRIORITIES.find(p => p.value === value) ?? PRIORITIES[2];

export const PLATFORMS = [
    { key: 'ios', label: 'iOS' },
    { key: 'android', label: 'Android' },
    { key: 'web', label: 'Web' },
];

export const RISKS = [
    { key: 'points_money',  label: 'Points / money' },
    { key: 'privacy',       label: 'Member data' },
    { key: 'security',      label: 'Security' },
    { key: 'stability',     label: 'Crashes' },
    { key: 'gyms_partners', label: 'Gyms / partners see it' },
    { key: 'store_policy',  label: 'Store policy' },
    { key: 'legal',         label: 'Legal' },
];

export const WAITING_ON = [
    { key: 'jamie',        label: 'Jamie' },
    { key: 'team',         label: 'The team' },
    { key: 'gym',          label: 'A gym' },
    { key: 'partner',      label: 'A partner' },
    { key: 'member',       label: 'A member' },
    { key: 'apple',        label: 'Apple' },
    { key: 'google',       label: 'Google' },
    { key: 'third_party',  label: 'Third party' },
    { key: 'native_build', label: 'Next native build' },
    { key: 'data',         label: 'More data' },
];
export const waitingLabel = (key) => WAITING_ON.find(w => w.key === key)?.label ?? key;

export const EFFORTS = [
    { key: 'xs', label: 'XS', hint: 'Under an hour · 1 pt' },
    { key: 's',  label: 'S',  hint: 'Half a day · 2 pts' },
    { key: 'm',  label: 'M',  hint: 'A day or two · 3 pts' },
    { key: 'l',  label: 'L',  hint: 'About a week · 5 pts' },
    { key: 'xl', label: 'XL', hint: 'Bigger — split it · 8 pts' },
];
// Sprint points. The database uses the same scale (tracker_effort_points).
export const EFFORT_POINTS = { xs: 1, s: 2, m: 3, l: 5, xl: 8 };
export const pointsOf = (issue) => EFFORT_POINTS[issue.effort] ?? 0;

export const TARGETS = ['Next OTA', 'Next EAS build', 'Next web deploy', 'Before the next live event', 'This week', 'Next week'];

// How a change reaches people. `options` makes the target a pick-list.
export const SHIP_KINDS = [
    { key: 'ota',       label: 'OTA update',          options: ['1.6.0', '1.5.1'],
      note: '1.5.1 only from the release-1.5.1 worktree; never to 1.5.0. Publish from a clean npm ci.' },
    { key: 'native',    label: 'Native build (EAS)',  options: ['iOS', 'Android', 'iOS + Android'] },
    { key: 'store',     label: 'Store release',       options: ['App Store', 'Google Play'] },
    { key: 'web',       label: 'Web deploy',          placeholder: 'powr.life (Vercel)' },
    { key: 'function',  label: 'Edge function',       options: EDGE_FUNCTIONS },
    { key: 'migration', label: 'Migration applied',   placeholder: '2026…_name.sql' },
    { key: 'config',    label: 'Config / switch',     placeholder: 'system_config key, portal switch…' },
    { key: 'cron',      label: 'Cron switched on',    placeholder: 'job name' },
    { key: 'backfill',  label: 'Data fix / backfill', placeholder: 'which rows' },
    { key: 'comms',     label: 'Tell people',         options: ['Members', 'Gyms', 'Partners', 'Affiliates', 'Team'] },
];
export const shipKindOf = (key) => SHIP_KINDS.find(k => k.key === key) ?? { key, label: key };

export const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// A starting ship plan from where the issue lives.
export function suggestShipSteps(issue) {
    const step = (kind, target = '') => ({ id: newId(), kind, target, done: false });
    switch (issue.surface) {
        case 'app':      return [step('ota', '1.6.0')];
        case 'backend':  return [step('migration'), step('function')];
        case 'email':    return [step('function')];
        case 'release':  return [];
        case 'ops':
        case 'brand':    return [];
        default:         return [step('web', 'powr.life')];
    }
}

export const issueKey = (issue) => `POWR-${issue.number}`;

export const parseIssueKey = (text) => {
    const m = String(text ?? '').trim().match(/^(?:powr-)?(\d+)$/i);
    return m ? Number(m[1]) : null;
};

export function shipProgress(steps) {
    const list = Array.isArray(steps) ? steps : [];
    return { done: list.filter(s => s.done).length, total: list.length };
}

export const isOpen = (issue) => issue.status !== 'verified' && issue.status !== 'closed';
// Finished work: proven, or closed as done (not dropped as won't do / duplicate).
export const isDone = (issue) => issue.status === 'verified' || (issue.status === 'closed' && issue.resolution === 'done');
// When it was finished, for "done this week" and the burndown.
export const doneAt = (issue) => (issue.status === 'verified' ? issue.verified_at : issue.status === 'closed' ? issue.closed_at : null);
export const resolutionLabel = (key) => RESOLUTIONS.find(r => r.key === key)?.label ?? 'Done';

export function ago(dateStr) {
    if (!dateStr) return '';
    const m = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 60) return `${d}d ago`;
    return `${Math.floor(d / 30)}mo ago`;
}

const DAY = 86400000;
const daysSince = (dateStr) => (Date.now() - new Date(dateStr).getTime()) / DAY;

// The stat tiles double as filters. Each one is a question the team asks.
export const QUICK_FILTERS = [
    { key: 'triage',    label: 'To triage',          test: i => i.status === 'triage' },
    { key: 'urgent',    label: 'P0 – P1 open',       test: i => i.priority <= 1 && isOpen(i) },
    { key: 'unshipped', label: 'Merged, not shipped', test: i => i.status === 'merged' },
    { key: 'unproven',  label: 'Live, not proven',   test: i => i.status === 'live' },
    { key: 'waiting',   label: 'Waiting on someone', test: i => !!i.waiting_on && isOpen(i) },
    { key: 'stale',     label: 'Untouched 14d+',     test: i => isOpen(i) && i.status !== 'triage' && daysSince(i.updated_at) > 14 },
    { key: 'done7',     label: 'Done this week',     test: i => isDone(i) && !!doneAt(i) && daysSince(doneAt(i)) <= 7 },
];

export function matchesSearch(issue, q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const key = parseIssueKey(needle);
    if (key != null && issue.number === key) return true;
    const pr = needle.match(/^#(\d+)$/);
    if (pr) return (issue.pr_numbers ?? []).includes(Number(pr[1]));
    return [issue.title, issue.description, issue.feature, issue.app_version, issueKey(issue), ...(issue.labels ?? [])]
        .some(v => (v ?? '').toLowerCase().includes(needle));
}

// Board order inside a column: most urgent first, then most recently touched.
export const byUrgency = (a, b) => (a.priority - b.priority) || (new Date(b.updated_at) - new Date(a.updated_at));

// Blank description to start from, by type. Only used while the field is empty.
export const TEMPLATES = {
    bug: '**What happens**\n\n\n**What should happen**\n\n\n**Where it was seen** (device, app version, user, gym)\n- \n\n**Evidence** (Sentry, Live Ops, logs, screenshots)\n- ',
    incident: '**Impact** (who, how many, since when)\n\n\n**Timeline**\n- \n\n**Mitigation so far**\n\n\n**Root cause**\n',
    feature: '**Why** (who it\'s for, what changes for them)\n\n\n**What**\n\n\n**Not in this**\n- ',
    improvement: '**Now**\n\n\n**Better**\n',
    task: '**What needs doing**\n\n\n**Done when**\n- ',
    debt: '**What\'s fragile**\n\n\n**What it costs us**\n\n\n**The fix**\n',
    investigation: '**Question**\n\n\n**What we know**\n- \n\n**What would answer it**\n- ',
};

// Support ticket categories → where the issue most likely lives.
const TICKET_PLACES = {
    points_rewards:   ['app', 'points'],
    account:          ['app', 'auth'],
    health_sync:      ['app', 'health'],
    gym_checkin:      ['app', 'geofencing'],
    challenges:       ['app', 'challenges'],
    technical:        ['app', 'platform'],
    feedback:         ['app', null],
    brand_request:    ['ops', 'partner_onboarding'],
    partner_setup:    ['partner_portal', 'integration'],
    partner_rewards:  ['partner_portal', 'rewards'],
    partner_account:  ['partner_portal', 'settings'],
    partner_other:    ['partner_portal', null],
    gym_package:      ['gym_portal', 'package'],
    gym_clash_night:  ['gym_portal', 'clash_nights'],
    gym_clash_cancel: ['gym_portal', 'clash_nights'],
    gym_event_review: ['gym_portal', 'events'],
    gym_help:         ['gym_portal', null],
};

export function draftFromTicket(ticket) {
    const [surface, area] = TICKET_PLACES[ticket.category] ?? ['app', null];
    const quoted = (ticket.message ?? '').split('\n').map(l => `> ${l}`).join('\n');
    return {
        type: ticket.category === 'feedback' || ticket.category === 'brand_request' ? 'feature' : 'bug',
        title: (ticket.subject ?? '').slice(0, 200),
        surface,
        area,
        description: `From a support ticket${ticket.brand_name ? ` (${ticket.brand_name})` : ''}:\n\n${quoted}\n`,
        user_ids: ticket.user_id ? [ticket.user_id] : [],
        partner_id: ticket.gym_partner_id ?? null,
        support_ticket_id: ticket.id,
        risks: ticket.category === 'points_rewards' ? ['points_money'] : [],
        source: 'support',
    };
}

// A brief to paste into a Claude Code session: where it lives in the repo,
// what's wrong, how it ships and how we'll know.
export function claudeBrief(issue, { origin = '' } = {}) {
    const area = areaOf(issue.surface, issue.area);
    const surface = surfaceOf(issue.surface);
    const lines = [
        `${issueKey(issue)} · ${typeOf(issue.type).label} · ${priorityOf(issue.priority).label} · ${statusOf(issue.status).label}`,
        `# ${issue.title}`,
        '',
        `Where: ${[surface?.label ?? issue.surface, area?.label, issue.feature].filter(Boolean).join(' › ')}`,
    ];
    if (issue.platforms?.length) lines.push(`Platforms: ${issue.platforms.join(', ')}${issue.app_version ? ` · app ${issue.app_version}` : ''}`);
    if (area?.paths?.length) lines.push(`Code to start from: ${area.paths.join(', ')}`);
    if (issue.pr_numbers?.length) lines.push(`PRs: ${issue.pr_numbers.map(n => `#${n}`).join(', ')}`);
    if (issue.description?.trim()) lines.push('', issue.description.trim());
    const steps = issue.ship_steps ?? [];
    if (steps.length) {
        lines.push('', 'Ship plan:');
        steps.forEach(s => lines.push(`- [${s.done ? 'x' : ' '}] ${shipKindOf(s.kind).label}${s.target ? `: ${s.target}` : ''}`));
    }
    if (issue.verify_how?.trim()) lines.push('', `Verified when: ${issue.verify_how.trim()}`);
    if (origin) lines.push('', `${origin}/admin/tracker?issue=${issueKey(issue)}`);
    return lines.join('\n');
}

// Open-issue counts per surface and area, for the ecosystem map.
export function ecosystemCounts(issues) {
    const out = {};
    for (const s of SURFACES) out[s.key] = { open: 0, unproven: 0, worst: null, areas: {} };
    for (const i of issues) {
        if (!isOpen(i)) continue;
        const s = out[i.surface] ?? (out[i.surface] = { open: 0, unproven: 0, worst: null, areas: {} });
        s.open += 1;
        if (i.status === 'live' || i.status === 'merged') s.unproven += 1;
        s.worst = s.worst == null ? i.priority : Math.min(s.worst, i.priority);
        const k = i.area ?? '_none';
        const a = s.areas[k] ?? (s.areas[k] = { open: 0, worst: null });
        a.open += 1;
        a.worst = a.worst == null ? i.priority : Math.min(a.worst, i.priority);
    }
    return out;
}

// GitHub, Sentry and friends get a name instead of a raw URL.
export function linkLabel(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (host.endsWith('sentry.io')) return 'Sentry';
        if (host === 'github.com') return 'GitHub';
        if (host.endsWith('slack.com')) return 'Slack';
        if (host === 'drive.google.com' || host === 'docs.google.com') return 'Google Drive';
        if (host === 'expo.dev') return 'Expo';
        if (host.endsWith('supabase.com')) return 'Supabase';
        if (host.endsWith('vercel.com')) return 'Vercel';
        if (host === 'claude.ai') return 'Claude';
        return host;
    } catch {
        return url;
    }
}

export const GITHUB_PR = (n) => `https://github.com/POWR-LIFE/POWR/pull/${n}`;

// ── Sprints ────────────────────────────────────────────────────────────────

export const sprintLabel = (sprint) => sprint?.name || (sprint ? `Sprint ${sprint.number}` : 'Backlog');

const dayStart = (iso) => new Date(`${iso}T00:00:00`);
export const DAY_MS = DAY;

// Whole days from today to the sprint's last day (0 = ends today, negative = overdue).
export function daysLeft(sprint, now = new Date()) {
    const end = dayStart(sprint.ends_on);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((end - today) / DAY);
}

export const fmtDay = (iso) => dayStart(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function addDays(iso, n) {
    const d = dayStart(iso);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Today on the admin's own calendar, not UTC's.
export const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// How a sprint is going, in the groups the progress bar shows.
export const PROGRESS_GROUPS = [
    { key: 'done',    label: 'Done',           color: '#10B981', test: isDone },
    { key: 'live',    label: 'Live, unproven', color: '#CBB800', test: i => i.status === 'live' },
    { key: 'merged',  label: 'Merged',         color: '#F97316', test: i => i.status === 'merged' },
    { key: 'review',  label: 'In review',      color: '#8B5CF6', test: i => i.status === 'review' },
    { key: 'doing',   label: 'In progress',    color: '#0EA5E9', test: i => i.status === 'doing' },
    { key: 'todo',    label: 'Not started',    color: '#D4D4CF', test: i => ['triage', 'backlog', 'next'].includes(i.status) },
    { key: 'dropped', label: 'Dropped',        color: '#A3A3A3', test: i => i.status === 'closed' && i.resolution !== 'done' },
];

export function sprintStats(issues) {
    const groups = Object.fromEntries(PROGRESS_GROUPS.map(g => [g.key, 0]));
    let points = 0;
    let pointsDone = 0;
    let unsized = 0;
    for (const i of issues) {
        const g = PROGRESS_GROUPS.find(x => x.test(i));
        if (g) groups[g.key] += 1;
        points += pointsOf(i);
        if (isDone(i)) pointsDone += pointsOf(i);
        if (!i.effort) unsized += 1;
    }
    return { total: issues.length, done: groups.done, groups, points, pointsDone, unsized };
}

/**
 * Burndown: issues still to do at the end of each sprint day, against the
 * straight line to zero. Uses who's in the sprint now (plus, once complete,
 * what carried over), so mid-sprint additions count from day one — the
 * summary's "added" number says how much that was.
 */
export function burndown(sprint, members, now = new Date()) {
    const days = [];
    const total = members.length;
    const length = Math.max(1, Math.round((dayStart(sprint.ends_on) - dayStart(sprint.starts_on)) / DAY) + 1);
    for (let d = 0; d < length; d++) {
        const iso = addDays(sprint.starts_on, d);
        const end = new Date(dayStart(iso).getTime() + DAY);
        const future = sprint.status !== 'completed' && dayStart(iso) > now;
        // Verified or closed (dropped work leaves the sprint too) by the end of that day.
        const remaining = future ? null : members.filter(i => {
            const at = doneAt(i);
            return !at || new Date(at) >= end;
        }).length;
        days.push({ iso, remaining, ideal: total - (total * (d + 1)) / length });
    }
    return { total, days };
}
