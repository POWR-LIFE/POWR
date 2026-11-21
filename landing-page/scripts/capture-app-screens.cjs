// Captures the shipped app's screens for the homepage's phones (public/app/*.webp).
//
// Renders the app on Expo web for a sample member and saves Home, the League
// (the Series), Spend, Progress, Discover and the profile at 390×844 (2x).
// Nothing is written to the database: the session is a fake, unsigned token
// in localStorage and every auth, REST and RPC call is answered below with
// sample data. Only public storage images and the public rewards catalogue
// are read from the real project, so the screens carry real artwork.
//
// Run it again whenever the app's screens change:
//   1. from the repo root:   npx expo start --web --port 8090 --offline --no-dev
//      (--no-dev: the dev-only prototypes and panels never ship)
//   2. in landing-page/:     node scripts/capture-app-screens.cjs
//      env: SCREENS=home,league  OUT=<dir>  APP_URL=http://localhost:8090
// Writes <OUT>/<screen>.png (default: public/app, as .webp via sharp if present).

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const APP = process.env.APP_URL || 'http://localhost:8090';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(ROOT, 'public/app');
const SCREENS = (process.env.SCREENS || 'home,league,league-running,rewards,progress,discover,profile').split(',');
const W = 390, H = 844;

// The public project: the catalogue is anon-readable, so the Spend tab shows the real rewards.
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const SB_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const uid = 'a1a1a1a1-0000-4000-8000-0000000000aa';
const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated', aud: 'authenticated', email: 'sample@local' })}.sig`;
const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'sample@local', app_metadata: {}, user_metadata: { onboarding_complete: true, full_name: 'Alex Carter' }, created_at: new Date(Date.now() - 240 * 864e5).toISOString() };
const session = { access_token: jwt, refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: exp, user };

const HOUR = 3600e3, DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
const AVATAR = (n) => `https://i.pravatar.cc/300?img=${n}`;
const PROFILE = { id: uid, display_name: 'Alex Carter', username: 'alexcarter', avatar_url: AVATAR(12), onboarding_complete: true, referral_code: 'ALEX42', timezone: 'Europe/London', country_code: 'GB', show_on_leaderboard: true, created_at: iso(Date.now() - 240 * DAY), level: 5, bio: null, home_gym_id: null };

// A sample member: twelve active days in a row; this week three gym sessions, two runs, a yoga class and walks.
const SESSIONS = [];
{
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const week = ['gym', 'running', 'gym', 'yoga', 'running', 'gym', 'walking'];
  const plan = Array.from({ length: 91 }, (_, d) => week[d % 7]);
  plan.forEach((type, d) => {
    const start = today.getTime() - d * DAY + (type === 'gym' ? 18 : 7) * HOUR;
    const dur = type === 'gym' ? 52 : type === 'running' ? 31 : type === 'yoga' ? 46 : 40;
    const pts = type === 'gym' ? 20 : type === 'running' ? 8 : type === 'yoga' ? 5 : 5;
    SESSIONS.push({ id: `s${d}`, user_id: uid, type, started_at: iso(start), ended_at: iso(start + dur * 60e3), duration_sec: dur * 60, distance_m: type === 'running' ? 5400 : null, steps: type === 'walking' ? 10400 : null, calories: null, verification: type === 'gym' ? 'geofence' : 'wearable', verified: true, trust_score: 1, raw_activity_name: null, partner_id: type === 'gym' ? 'p-one-ldn' : null, points_awarded: pts, point_transactions: [{ amount: pts }] });
    // Steps most days, as a walking day row
    if (type !== 'walking' && d % 2 === 0) SESSIONS.push({ id: `w${d}`, user_id: uid, type: 'walking', started_at: iso(start - 5 * HOUR), ended_at: iso(start - 4 * HOUR), duration_sec: 3600, distance_m: 7800, steps: 11200, verification: 'health', verified: true, trust_score: 1, raw_activity_name: null, partner_id: null, points_awarded: 5, point_transactions: [{ amount: 5 }] });
  });
}

const GUN = '2026-11-15T00:00:00Z';
const SEASON = { slug: 'autumn-26', name: 'Autumn Series', look: 'autumn', number: 1, code: 'AS26', starts_on: '2026-10-01', ends_on: '2026-12-31', round: 'Round 01' };
const ROUND = { slug: 'autumn-01', name: 'Round 01', starts_at: GUN, ends_at: '2026-12-01T00:00:00Z', day: 0, days: 16, draw_days: 10 };
const JOIN = { slug: 'autumn-01', name: 'Round 01', starts_at: GUN, ends_at: '2026-12-01T00:00:00Z', draw_days: 10 };
const BOARD_UPCOMING = { state: 'upcoming', round: ROUND, next: { slug: 'autumn-02', name: 'Round 02', starts_at: '2026-12-15T00:00:00Z' }, joined: true, join: JOIN, total: 0, me: null, rows: [], rival: null, gym: null, duels: { week_start: iso(Date.now()), ends_at: iso(Date.now() + 3 * DAY), you: 0, active: [], invites: [], sent: [], open: [] } };
const INVITE = { round: { slug: 'autumn-01', name: 'Round 01', starts_at: GUN }, open: true, opens_at: '2026-10-26T15:01:51Z',
  rows: [{ rank: 1, name: 'Maya Okafor', friends: 4, joining: 1, you: false }, { rank: 2, name: 'Alex Carter', friends: 3, joining: 1, you: true }, { rank: 3, name: 'Theo Lindqvist', friends: 2, joining: 0, you: false }, { rank: 4, name: 'Jack Reid', friends: 1, joining: 2, you: false }],
  ranked: 4, start_line: 6, me: { rank: 2, friends: 3, joining: 1, code: 'ALEX42', joined: true },
  crowd: { real: 10, pacers_at_gun: 1490, ramp_from: '2026-10-26T15:01:51Z', ramp_to: GUN, base: 0.835 } };
const NAMES = ['Maya Okafor', 'Theo Lindqvist', 'Priya Nair', 'Sam Walsh', 'Jack Reid', 'Hannah Brooks', 'Leo Marchetti', 'Amara Diallo'];
const row = (rank, name, points, today, you = false, img = null) => ({ user_id: `u-${rank}`, name, avatar_url: img ? AVATAR(img) : null, rank, rank_mid: rank + (rank === 12 ? 3 : rank === 1 ? 0 : 1), points, today, you, country: 'GB', honours: [] });
const BOARD_RUNNING = {
  state: 'running', round: { ...ROUND, starts_at: iso(Date.now() - 3 * DAY - 10 * HOUR), ends_at: iso(Date.now() + 12 * DAY + 14 * HOUR), day: 4, days: 16 },
  next: { slug: 'autumn-02', name: 'Round 02', starts_at: '2026-12-15T00:00:00Z' }, joined: true, join: null, total: 1500,
  me: { rank: 12, rank_mid: 15, points: 184, today: 20, days: [1, 2, 3, 4] },
  rows: [row(1, NAMES[0], 312, 28, false, 47), row(2, NAMES[1], 296, 20, false, 33), row(3, NAMES[2], 281, 25, false, 26), row(11, NAMES[5], 191, 8), row(12, 'Alex Carter', 184, 20, true, 12), row(13, NAMES[3], 176, 0, false, 56), row(14, NAMES[6], 170, 13)],
  rival: { user_id: 'u-11', name: NAMES[5], rank: 11, points: 191, today: 8, friend: true },
  city: { you: null, rank: null, members: null, open: false, min_cities: 3, cities: [], forming: 2, options: null },
  gym: { id: 'p-one-ldn', name: 'ONE LDN', address: 'Imperial Wharf, London', people: 23, court: [{ user_id: 'u-3', name: NAMES[2], points: 80, rank: 1, you: false }, { user_id: uid, name: 'Alex Carter', points: 60, rank: 2, you: true }, { user_id: 'u-5', name: NAMES[4], points: 40, rank: 3, you: false }] },
  duels: { week_start: iso(Date.now() - 2 * DAY), ends_at: iso(Date.now() + 4 * DAY), you: 48, active: [{ id: 'd1', user_id: 'u-2', name: NAMES[1], them: 41, w: 2, l: 1 }], invites: [], sent: [], open: [{ user_id: 'u-5', name: NAMES[4] }] },
};
const SUMMARY = [{ balance: 1279, today_earned: 20, weekly_earned: 96, monthly_earned: 412, total_earned: 5794, vault_pending: 0, vault_next_vest_at: null }];

let REWARDS = [];
async function prefetchRewards() {
  const r = await fetch(`${SB_URL}/rest/v1/rewards?active=eq.true&select=*,partners(id,name,partner_code,logo_url,category,checkout_url_template)&order=sort_order.asc`, { headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` } });
  REWARDS = r.ok ? await r.json() : [];
  console.log('rewards prefetched:', REWARDS.length);
}

// Enough of PostgREST's filters for the reads the screens make: col=op.value.
function filterRows(url, rows) {
  const q = new URL(url).searchParams;
  let out = rows;
  for (const [k, v] of q.entries()) {
    const m = /^(eq|neq|gte|lte|gt|lt|is)\.(.*)$/.exec(v);
    if (!m || ['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [, op, raw] = m;
    out = out.filter((r) => {
      if (!(k in r)) return true;
      const a = r[k]; const b = decodeURIComponent(raw);
      if (op === 'is') return b === 'null' ? a == null : b === 'true' ? a === true : a === false;
      const ta = Date.parse(a), tb = Date.parse(b);
      const cmp = !Number.isNaN(ta) && !Number.isNaN(tb) && /\d{4}-\d\d-\d\d/.test(b) ? ta - tb : (String(a) < b ? -1 : String(a) > b ? 1 : 0);
      return op === 'eq' ? String(a) === b : op === 'neq' ? String(a) !== b : op === 'gte' ? cmp >= 0 : op === 'lte' ? cmp <= 0 : op === 'gt' ? cmp > 0 : cmp < 0;
    });
  }
  const lim = Number(q.get('limit'));
  return lim ? out.slice(0, lim) : out;
}

const unmatched = new Set();
function makeAnswer(screen) {
  return function answer(req) {
    const url = req.url();
    const method = req.method();
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    const json = (body, status = 200, extra = {}) => req.respond({ status, contentType: 'application/json', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const rows = (list) => (single ? (list[0] ? json(list[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(list, 200, { 'content-range': list.length ? `0-${list.length - 1}/${list.length}` : '*/0' }));
    if (method === 'OPTIONS') return req.respond({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/storage/v1/')) return req.continue();
    if (url.includes('/auth/v1/user')) return json(user);
    if (url.includes('/auth/v1/')) return json({});
    if (url.includes('/rpc/get_my_points_summary')) return json(SUMMARY);
    if (url.includes('/rpc/series_status')) return json({ on: true, season: SEASON });
    if (url.includes('/rpc/series_enabled')) return json(true);
    if (url.includes('/rpc/get_series_board')) return json(screen === 'league-running' ? BOARD_RUNNING : BOARD_UPCOMING);
    if (url.includes('/rpc/get_series_invite_board')) return json(INVITE);
    if (url.includes('/rpc/get_series_moments')) return json([]);
    if (url.includes('/rpc/get_series_prize_race')) return json({});
    if (url.includes('/rpc/get_series_results')) return json(null);
    if (url.includes('/rpc/get_honours')) return json([]);
    if (url.includes('/rpc/get_my_drop')) return json(null);
    if (url.includes('/rpc/get_active_live_events')) return json([]);
    if (url.includes('/rpc/get_active_live_event')) return json(null);
    if (url.includes('/rest/v1/profiles')) return rows([PROFILE]);
    if (url.includes('/rest/v1/activity_sessions')) return rows(filterRows(url, SESSIONS));
    if (url.includes('/rest/v1/user_streaks')) return rows([{ user_id: uid, current_streak: 12, longest_streak: 23, last_activity_date: new Date().toISOString().slice(0, 10), streak_freezes: 0 }]);
    if (url.includes('/rest/v1/rewards')) return rows(filterRows(url, REWARDS));
    if (url.includes('/rest/v1/series_prizes')) return rows([]);
    if (url.includes('/rest/v1/rpc/')) { unmatched.add(`${screen} rpc ${new URL(url).pathname.split('/rpc/')[1]}`); return json(null); }
    if (url.includes('/functions/v1/')) { unmatched.add(`${screen} fn ${new URL(url).pathname.split('/functions/v1/')[1]}`); return json({}); }
    if (url.includes('/rest/v1/')) {
      unmatched.add(`${screen} rest ${new URL(url).pathname.split('/rest/v1/')[1]}`);
      if (method === 'HEAD') return req.respond({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, body: '' });
      return rows([]);
    }
    return json({});
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hideDevBits(page) {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('div')) {
      if (d.children.length === 0 && /DEV TOOLS|Series dev controls|Series sample data/.test(d.textContent || '')) {
        let el = d; for (let i = 0; i < 6 && el; i++) el = el.parentElement;
        if (el) el.style.display = 'none';
      }
    }
  });
}

(async () => {
  await prefetchRewards();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--lang=en-GB'] });
  fs.mkdirSync(OUT, { recursive: true });
  for (const screen of SCREENS) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    const answer = makeAnswer(screen);
    page.on('request', (req) => (req.url().includes('supabase.co') ? answer(req) : req.continue()));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    await page.evaluateOnNewDocument((key, value, levelKey) => {
      localStorage.setItem(key, value);
      localStorage.setItem('@powr/notification_prompt_state', JSON.stringify({ lastPromptAt: Date.now(), dismissCount: 3, onboardingDeclinedAt: null }));
      localStorage.setItem(levelKey, JSON.stringify({ level: 5, totalEarned: 5794 }));
      const isoWeek = (date) => { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const n = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - n); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${String(Math.ceil((((d - y) / 864e5) + 1) / 7)).padStart(2, '0')}`; };
      localStorage.setItem('@powr/weekly_recap_dismissed', isoWeek(new Date(Date.now() - 7 * 864e5)));
    }, 'sb-wjvvujnicwkruaeibttt-auth-token', JSON.stringify(session), `@powr/level_seen:${uid}`);

    await page.goto(`${APP}/(tabs)`, { waitUntil: 'load', timeout: 240000 });
    await sleep(9000);
    const tab = { league: '/league', 'league-running': '/league', rewards: '/rewards', progress: '/progress', discover: '/discover' }[screen];
    if (tab) {
      await page.evaluate((href) => { const a = document.querySelector(`a[href="${href}"]`); if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }, tab);
      await sleep(6000);
    }
    if (screen === 'profile') {
      await page.mouse.click(356, 28);
      await sleep(5000);
    }
    await hideDevBits(page);
    await sleep(600);
    const file = path.join(OUT, `${screen}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(`\n[${screen}] -> ${file}${errors.length ? `\n  page errors: ${errors.join(' // ')}` : ''}`);
    await page.close();
  }
  console.log('\nunmatched calls (answered with empty):\n  ' + [...unmatched].sort().join('\n  '));
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
