// Tracker → Slack: which channel hears about what, and what it says.
//
// Every issue has a home channel, by type: what's broken (bug, incident)
// lives in #issues; planned work (feature, improvement, task, tech debt,
// investigation) lives in #development. It's posted there when filed and,
// with a bot token, every later move is a reply in that thread.
//
// #development also hears the shipping flow — in review, merged, live,
// verified — for everything, because that's where work stalls between "the
// code is done" and "a member has it". For planned work that's its own thread,
// so the update is one reply shown in the channel, never a second post.
//
// Pure, so it's tested from __tests__/tracker-slack.test.ts. The handler
// (tracker-slack/index.ts) does the posting.

export type TrackerIssue = {
  id: string;
  number: number;
  title: string;
  type: string;
  status: string;
  resolution?: string | null;
  priority: number;
  surface: string;
  area?: string | null;
  feature?: string | null;
  platforms?: string[];
  risks?: string[];
  pr_numbers?: number[];
  ship_steps?: { kind: string; target?: string; done?: boolean }[];
  verify_how?: string | null;
  verified_note?: string | null;
  source?: string;
};

export type TrackerEvent = {
  kind: 'created' | 'updated';
  issue: TrackerIssue;
  old?: { status?: string; priority?: number; assignee_id?: string | null } | null;
  actor?: string | null;
  assignee?: string | null;
  assignee_id?: string | null;
};

export type SprintEvent = {
  kind: 'sprint';
  sprint: {
    id: string;
    number: number;
    name: string;
    goal?: string | null;
    starts_on: string;
    ends_on: string;
    status: 'active' | 'completed';
    summary?: {
      committed?: number; added?: number; total?: number; done?: number; dropped?: number; live?: number;
      points?: number; points_done?: number; carried?: number; carried_to_name?: string | null;
    } | null;
  };
  issues: { number: number; title: string; priority: number; effort?: string | null; status: string }[];
  actor?: string | null;
};

export type SlackPost = {
  channel: 'issues' | 'dev';
  text: string; // notification fallback
  blocks: unknown[];
  // Reply in the issue's #issues thread rather than posting to the channel.
  thread?: boolean;
  // A thread reply the whole channel should see too (or, with no thread
  // to reply in, worth a post of its own).
  broadcast?: boolean;
  // This post IS the issue's thread: remember it.
  saveThread?: boolean;
};

export const SITE = 'https://powr.life';

// Copied from landing-page/src/pages/admin/tracker/taxonomy.js — the test
// fails if they drift. Unknown keys fall back to the key itself.
export const PLACE_LABELS: Record<string, { label: string; areas: Record<string, string> }> = {
  app: { label: 'Member app', areas: { onboarding: 'Onboarding', auth: 'Sign-in & account', home: 'Home', geofencing: 'Gym check-in (geofencing)', points: 'Points & levels', health: 'Health & wearables', progress: 'Progress', discover: 'Discover & gyms', league: 'League & live events', challenges: 'Challenges & achievements', social: 'Friends & sharing', rewards: 'Rewards & wallet', notifications: 'Notifications', settings: 'Settings & profile', platform: 'Stability & platform' } },
  gym_portal: { label: 'Gym Portal', areas: { home: 'Overview', events: 'Events', clash_nights: 'Clash Nights', studio: 'Gym Studio', screens: 'Screens', members: 'Members & insights', retention: 'Retention', settings: 'Settings & team', package: 'Package & billing', partners: 'Partner discounts', poster: 'Poster', access: 'Login & access', i18n: 'Languages' } },
  partner_portal: { label: 'Partner Portal', areas: { home: 'Home & performance', rewards: 'Rewards', promo_codes: 'Promo codes', featured: 'Featured & placements', redemptions: 'Redemptions', integration: 'Integrations', settings: 'Settings & team', access: 'Login & setup' } },
  affiliate_portal: { label: 'Affiliate Portal', areas: { home: 'Home', links: 'Links', conversions: 'Conversions', rewards: 'Rewards & ladder', access: 'Login, setup & terms' } },
  admin: { label: 'Admin panel', areas: { users: 'Users & profiles', gyms: 'Gyms & gym portals', partners: 'Partners & rewards', affiliates: 'Affiliates & athletes', challenges: 'Challenges', events: 'Live events', ops: 'Live Ops & sessions', health: 'System Health', analytics: 'Analytics & usage', comms: 'Comms', studio: 'Studio', support: 'Support', vault: 'Vault', config: 'Config & audit', tracker: 'Tracker' } },
  screens: { label: 'Big screens', areas: { gym_board: 'Gym board', gym_clash: 'Gym Clash board', event_board: 'Live event board', event_promo: 'Event promo' } },
  web: { label: 'Website', areas: { landing: 'Home & story', audiences: 'Partners & affiliates pages', public: 'Support & legal', flows: 'Public flows', og: 'Share previews (OG)' } },
  backend: { label: 'Backend', areas: { points: 'Points & claims', visits: 'Gym visits & presence', health_ingest: 'Health ingest', challenges: 'Challenges engine', events: 'Live events engine', rewards: 'Rewards & redemption', push: 'Push delivery', crons: 'Crons & scheduled jobs', security: 'RLS & security', schema: 'Schema & data', auth: 'Auth', integrations: 'Third-party integrations' } },
  email: { label: 'Email', areas: { member: 'Member emails', gym: 'Gym emails', partner: 'Partner emails', delivery: 'Delivery & templates' } },
  release: { label: 'Build & release', areas: { ota: 'OTA updates', native: 'Native builds (EAS)', stores: 'App Store & Play', web_deploy: 'Web deploys', supabase_deploy: 'Supabase deploys', ci: 'CI & repo health', observability: 'Monitoring', secrets: 'Keys & secrets' } },
  ops: { label: 'Operations & data', areas: { gym_data: 'Gym directory data', event_nights: 'Event nights', gym_onboarding: 'Gym onboarding', partner_onboarding: 'Brand onboarding', support_followups: 'Member follow-ups', demo_data: 'Demo & seed data' } },
  brand: { label: 'Brand & content', areas: { social: 'Social posts', video: 'Trailers & explainers', decks: 'Decks & sales', copy: 'Copy & naming' } },
};

const STATUS: Record<string, string> = {
  triage: 'Triage', backlog: 'Backlog', next: 'Up next', doing: 'In progress', review: 'In review',
  merged: 'Merged', live: 'Live', verified: 'Verified', closed: 'Closed',
};
const RESOLUTION: Record<string, string> = { done: 'Done', wont_do: "Won't do", duplicate: 'Duplicate', cant_repro: "Can't reproduce" };
const TYPE: Record<string, [string, string]> = {
  bug: [':bug:', 'Bug'], incident: [':rotating_light:', 'Incident'], feature: [':sparkles:', 'Feature'],
  improvement: [':chart_with_upwards_trend:', 'Improvement'], task: [':ballot_box_with_check:', 'Task'],
  debt: [':wrench:', 'Tech debt'], investigation: [':mag:', 'Investigation'],
};
const PRIORITY = ['P0 · Now', 'P1 · This week', 'P2 · Normal', 'P3 · Someday'];
const RISK: Record<string, string> = {
  points_money: 'points / money', privacy: 'member data', security: 'security', stability: 'crashes',
  gyms_partners: 'gyms / partners see it', store_policy: 'store policy', legal: 'legal',
};
const PLATFORM: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web' };
const SHIP: Record<string, string> = {
  ota: 'OTA', native: 'Native build', store: 'Store release', web: 'Web deploy', function: 'Edge function',
  migration: 'Migration', config: 'Config', cron: 'Cron', backfill: 'Data fix', comms: 'Tell people',
};
// Statuses #development hears about.
const DEV_STATUSES = new Set(['review', 'merged', 'live', 'verified']);

// Where an issue lives: broken things in #issues, planned work in #development.
export const homeOf = (type: string): 'issues' | 'dev' => (type === 'bug' || type === 'incident' ? 'issues' : 'dev');

// Slack reads &, < and > as markup.
export const esc = (s: unknown, max = 300) =>
  String(s ?? '').slice(0, max).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const issueUrl = (i: TrackerIssue) => `${SITE}/admin/tracker?issue=POWR-${i.number}`;
const key = (i: TrackerIssue) => `<${issueUrl(i)}|POWR-${i.number}>`;
const prs = (i: TrackerIssue) =>
  (i.pr_numbers ?? []).map(n => `<https://github.com/POWR-LIFE/POWR/pull/${n}|#${n}>`).join(', ');

export function placeLabel(i: TrackerIssue) {
  const s = PLACE_LABELS[i.surface];
  return [s?.label ?? i.surface, i.area ? (s?.areas[i.area] ?? i.area) : null, i.feature].filter(Boolean).join(' › ');
}

const section = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });
const context = (parts: (string | null | undefined | false)[]) => {
  const t = parts.filter(Boolean).join('  ·  ');
  return t ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: t }] }] : [];
};

function filed(e: TrackerEvent): SlackPost {
  const i = e.issue;
  const home = homeOf(i.type);
  const [emoji, typeName] = TYPE[i.type] ?? [':memo:', i.type];
  const urgent = i.priority === 0;
  const head = `${urgent ? ':rotating_light: ' : ''}${emoji} ${key(i)}  *${PRIORITY[i.priority] ?? `P${i.priority}`}*  ·  ${typeName}`;
  const risks = (i.risks ?? []).map(r => RISK[r] ?? r);
  return {
    channel: home,
    saveThread: true,
    text: `POWR-${i.number} ${PRIORITY[i.priority] ?? ''}: ${i.title}`.slice(0, 280),
    blocks: [
      section(`${head}\n*${esc(i.title, 200)}*`),
      ...context([
        esc(placeLabel(i)),
        (i.platforms ?? []).length ? (i.platforms ?? []).map(p => PLATFORM[p] ?? p).join(', ') : null,
        risks.length ? `:warning: ${esc(risks.join(', '))}` : null,
        prs(i) ? `PR ${prs(i)}` : null,
        i.source === 'support' ? 'from a support ticket' : null,
        e.actor ? `filed by ${esc(e.actor, 60)}` : i.source === 'claude' ? 'filed by Claude' : null,
      ]),
    ],
  };
}

function devPost(e: TrackerEvent): SlackPost {
  const i = e.issue;
  const title = `*${esc(i.title, 200)}*`;
  const steps = i.ship_steps ?? [];
  const todo = steps.filter(s => !s.done).map(s => `${SHIP[s.kind] ?? s.kind}${s.target ? ` ${esc(s.target, 60)}` : ''}`);
  const who = e.actor ? `by ${esc(e.actor, 60)}` : null;
  switch (i.status) {
    case 'review':
      return {
        channel: 'dev', text: `POWR-${i.number} in review: ${i.title}`.slice(0, 280),
        blocks: [section(`:eyes: ${key(i)} is in review\n${title}`), ...context([prs(i) ? `PR ${prs(i)}` : 'No PR linked yet', esc(placeLabel(i)), who])],
      };
    case 'merged':
      return {
        channel: 'dev', text: `POWR-${i.number} merged, not shipped: ${i.title}`.slice(0, 280),
        blocks: [
          section(`:twisted_rightwards_arrows: ${key(i)} is merged — nobody has it yet\n${title}`),
          ...context([
            todo.length ? `To ship: ${todo.join(', ')}` : steps.length ? 'Every ship step is ticked' : 'No ship plan yet',
            prs(i) ? `PR ${prs(i)}` : null, who,
          ]),
        ],
      };
    case 'live':
      return {
        channel: 'dev', text: `POWR-${i.number} is live, needs proof: ${i.title}`.slice(0, 280),
        blocks: [
          section(`:rocket: ${key(i)} is live — needs proof\n${title}`),
          ...context([
            i.verify_how ? `How we'll know: ${esc(i.verify_how, 400)}` : 'No "how we\'ll know" written yet',
            todo.length ? `:warning: still unticked: ${todo.join(', ')}` : null, who,
          ]),
        ],
      };
    default: // verified
      return {
        channel: 'dev', text: `POWR-${i.number} verified: ${i.title}`.slice(0, 280),
        blocks: [section(`:white_check_mark: ${key(i)} is verified\n${title}`), ...context([i.verified_note ? `Proof: ${esc(i.verified_note, 400)}` : null, who])],
      };
  }
}

const POINTS: Record<string, number> = { xs: 1, s: 2, m: 3, l: 5, xl: 8 };
const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// #development hears a sprint start (the commitment) and finish (how it went).
export function sprintPosts(e: SprintEvent): SlackPost[] {
  const s = e.sprint;
  const link = `<${SITE}/admin/tracker?sprint=${s.number}|${esc(s.name, 80)}>`;
  const who = e.actor ? `by ${esc(e.actor, 60)}` : null;
  if (s.status === 'active') {
    const points = e.issues.reduce((n, i) => n + (POINTS[i.effort ?? ''] ?? 0), 0);
    const shown = e.issues.slice(0, 12).map(i =>
      `• <${SITE}/admin/tracker?issue=POWR-${i.number}|POWR-${i.number}>  P${i.priority}  ${esc(i.title, 120)}`);
    if (e.issues.length > shown.length) shown.push(`…and ${e.issues.length - shown.length} more`);
    return [{
      channel: 'dev',
      text: `${s.name} started: ${plural(e.issues.length, 'issue')}`,
      blocks: [
        section(`:checkered_flag: *${link}* has started  ·  ${day(s.starts_on)} → ${day(s.ends_on)}${s.goal ? `\n*Goal:* ${esc(s.goal, 400)}` : ''}`),
        ...(shown.length ? [section(shown.join('\n'))] : []),
        ...context([plural(e.issues.length, 'issue'), points ? `${points} points` : null, who]),
      ],
    }];
  }
  const m = s.summary ?? {};
  const total = m.total ?? 0;
  return [{
    channel: 'dev',
    text: `${s.name} complete: ${m.done ?? 0} of ${total} done`,
    blocks: [
      section(`:trophy: *${link}* is complete — *${m.done ?? 0} of ${total}* done${s.goal ? `\n*Goal was:* ${esc(s.goal, 400)}` : ''}`),
      ...context([
        m.live ? `${m.live} live, awaiting proof` : null,
        m.dropped ? `${m.dropped} dropped` : null,
        m.carried ? `${m.carried} carried to ${m.carried_to_name ? esc(m.carried_to_name, 80) : 'the backlog'}` : 'nothing carried over',
        m.points ? `${m.points_done ?? 0}/${m.points} points` : null,
        m.added ? `${plural(m.added, 'issue')} added mid-sprint` : null,
        who,
      ]),
    ],
  }];
}

/**
 * What to post for one change. `threaded` = a bot token is configured, so
 * replies can go in the issue's thread in its home channel; with webhooks
 * only there are no threads, so the home channel just hears filed, P0 and
 * resolved.
 */
export function planPosts(e: TrackerEvent, { threaded }: { threaded: boolean }): SlackPost[] {
  const i = e.issue;
  if (e.kind === 'created') return [filed(e)];

  const home = homeOf(i.type);
  const posts: SlackPost[] = [];
  const old = e.old ?? {};
  const actor = e.actor ? esc(e.actor, 60) : 'Someone';
  const statusMoved = old.status !== undefined && old.status !== i.status;
  const resolved = statusMoved && (i.status === 'verified' || i.status === 'closed');
  const toP0 = i.priority === 0 && old.priority !== undefined && old.priority !== 0;
  const assigned = e.old && 'assignee_id' in e.old && e.old.assignee_id !== (e.assignee_id ?? null);

  const devMove = statusMoved && DEV_STATUSES.has(i.status);
  // Planned work already lives in #development: its shipping update is a
  // reply in its own thread, shown in the channel, and stands for the move.
  const devMoveInHome = devMove && home === 'dev';

  if (devMove) posts.push(devMoveInHome && threaded ? { ...devPost(e), thread: true, broadcast: true } : devPost(e));

  if (statusMoved && !devMoveInHome && (threaded || resolved)) {
    const to = i.status === 'closed' ? `Closed · ${RESOLUTION[i.resolution ?? 'done'] ?? i.resolution}` : STATUS[i.status] ?? i.status;
    const emoji = i.status === 'verified' ? ':white_check_mark: ' : i.status === 'closed' ? ':heavy_minus_sign: ' : '';
    posts.push({
      channel: home, thread: true, broadcast: resolved,
      text: `POWR-${i.number} → ${to}`,
      blocks: [section(`${emoji}${key(i)} ${actor} moved it *${STATUS[old.status!] ?? old.status}* → *${to}*${resolved ? `\n${esc(i.title, 200)}` : ''}`)],
    });
  }
  if (toP0) {
    posts.push({
      channel: home, thread: true, broadcast: true,
      text: `POWR-${i.number} raised to P0: ${i.title}`.slice(0, 280),
      blocks: [section(`:rotating_light: ${key(i)} ${actor} raised it to *P0 · Now*\n*${esc(i.title, 200)}*`)],
    });
  }
  if (assigned && threaded) {
    posts.push({
      channel: home, thread: true,
      text: `POWR-${i.number} assigned`,
      blocks: [section(e.assignee ? `${actor} assigned it to *${esc(e.assignee, 60)}*` : `${actor} unassigned it`)],
    });
  }
  return posts;
}
