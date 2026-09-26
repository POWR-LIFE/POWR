// Captures the REAL app's Home screen for the portal's phone preview
// (src/components/EventAppPreview.jsx), so the preview shows Home as it is
// rather than a drawing of it.
//
// It renders app/(tabs)/index.tsx on Expo web for a sample member, scrolls
// until a live event card sits in full view, notes the card's box, hides the
// card and saves what's left: header, sticky activity rings, the sections
// above and below. The preview draws the gym's own card into that box.
//
// Nothing reaches the database: *.supabase.co resolves to 127.0.0.1 inside
// the browser (Realtime can't connect) and every REST, RPC and auth call is
// answered below with sample data.
//
// Run it again whenever Home changes, then commit both outputs:
//   1. from the repo root:   npx expo start --web --port 8090
//   2. in landing-page/:     npm i --no-save puppeteer-core
//                            node scripts/capture-app-home.cjs
// Writes public/app-preview/home-event-backdrop.webp (the phone's screen
// above the tab bar, status bar area included) and
// src/components/appPreviewHome.json (the card's box and the capture date).

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const APP = process.env.APP_URL || 'http://localhost:8090';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..');
const OUT_IMG = path.join(ROOT, 'public/app-preview/home-event-backdrop.webp');
const OUT_JSON = path.join(ROOT, 'src/components/appPreviewHome.json');

// iPhone 14/15 logical size. On the phone Home pads its content by the
// status bar's safe area (the background runs underneath) and ends at the 84pt
// tab bar. Web has no safe area and a 64pt tab bar, so the page is sized to
// leave the same 760pt above the tab bar and the 50pt pad is added by hand.
const W = 390;
const STATUS_H = 50;
const TOP_H = 844 - 84;           // status bar area + Home's content
const WEB_H = TOP_H + 64;
const CARD_TOP = STATUS_H + 282;  // where the card rests: the Together prompt above, this week's challenges below

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const uid = '00000000-0000-4000-8000-000000000001';
const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated', aud: 'authenticated', email: 'sample@local' })}.sig`;
const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'sample@local', app_metadata: {}, user_metadata: { onboarding_complete: true, full_name: 'Sam Taylor' }, created_at: new Date(Date.now() - 90 * 864e5).toISOString() };
const session = { access_token: jwt, refresh_token: 'x', token_type: 'bearer', expires_in: 86400, expires_at: exp, user };

const HOUR = 3600e3, DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();

// Any live event will do: the card is measured, then hidden.
const EVENT = {
  id: '00000000-0000-4000-8000-0000000000e1', name: 'Sample event', slug: 'sample-event', rules: [], scope: 'opt_in',
  venue: { id: '00000000-0000-4000-8000-0000000000a1', name: 'Your gym', logo_url: null, logo_bg: 'dark' },
  prizes: [], status: 'live',
  viewer: { gate: null, joined: false, booking: { confirmed: false, opened_at: null }, eligible: true, disqualified: false },
  lock_at: iso(Date.now() + 6 * DAY), logo_url: null, is_locked: false, logo_only: false, board_size: 20, is_preview: false,
  managed_by: 'gym', booking_url: null, revealed_at: null, audience_mode: 'venue', doors_open_at: null, doors_close_at: null,
  window_start_at: iso(Date.now() - DAY), window_end_at: iso(Date.now() + 6 * DAY), promo_headline: null, promo_media_url: null,
  invite_milestone_n: 0, invite_bonus_points: 20, conversion_deadline_at: null, invite_milestone_bonus: 0, reward_referrals_on_signup: false,
};
const PROFILE = { id: uid, display_name: 'Sam Taylor', username: 'samt', avatar_url: null, onboarding_complete: true, referral_code: 'SAMT42', timezone: 'Europe/London', created_at: iso(Date.now() - 90 * DAY) };

// A sample member: ten active days in a row, and this week two gym sessions,
// a run and some walks, so the rings and streak read like a real week.
const SESSIONS = [];
{
  const today = new Date(); today.setHours(0, 0, 0, 0);
  ['gym', 'walking', 'running', 'gym', 'walking', 'walking', 'gym', 'running', 'walking', 'gym'].forEach((type, d) => {
    const start = today.getTime() - d * DAY + 7 * HOUR;
    SESSIONS.push({ id: `s${d}`, user_id: uid, type, started_at: iso(start), ended_at: iso(start + 55 * 60e3), duration_sec: 3300, distance_m: type === 'running' ? 5200 : null, steps: type === 'walking' ? 10400 : null, verification: 'geofence', trust_score: 1, raw_activity_name: null, point_transactions: [{ amount: 20 }] });
  });
}

// Enough of PostgREST's filters for the reads Home makes: col=op.value.
function filterRows(url, rows) {
  const q = new URL(url).searchParams;
  let out = rows;
  for (const [k, v] of q.entries()) {
    const m = /^(eq|neq|gte|lte|gt|lt)\.(.*)$/.exec(v);
    if (!m || ['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [, op, raw] = m;
    out = out.filter((r) => {
      if (!(k in r)) return true;
      const a = r[k]; const b = decodeURIComponent(raw);
      const ta = Date.parse(a), tb = Date.parse(b);
      const cmp = !Number.isNaN(ta) && !Number.isNaN(tb) && /\d{4}-\d\d-\d\d/.test(b) ? ta - tb : (String(a) < b ? -1 : String(a) > b ? 1 : 0);
      return op === 'eq' ? String(a) === b : op === 'neq' ? String(a) !== b : op === 'gte' ? cmp >= 0 : op === 'lte' ? cmp <= 0 : op === 'gt' ? cmp > 0 : cmp < 0;
    });
  }
  return out;
}

function answer(req) {
  const url = req.url();
  const method = req.method();
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
  const json = (body, status = 200, extra = {}) => req.respond({ status, contentType: 'application/json', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return req.respond({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (url.includes('/storage/v1/')) return req.respond({ status: 404, headers, body: '' });
  if (url.includes('/auth/v1/user')) return json(user);
  if (url.includes('/auth/v1/')) return json({});
  if (url.includes('/rpc/get_my_points_summary')) return json([{ balance: 415, today_earned: 20, weekly_earned: 120, monthly_earned: 340, total_earned: 1415, vault_pending: 0, vault_next_vest_at: null }]);
  if (url.includes('/rpc/get_active_live_events')) return json([EVENT]);
  if (url.includes('/rpc/get_active_live_event')) return json(EVENT);
  if (url.includes('/rest/v1/profiles')) return single ? json(PROFILE) : json([PROFILE], 200, { 'content-range': '0-0/1' });
  if (url.includes('/rest/v1/activity_sessions')) {
    const rows = filterRows(url, SESSIONS);
    return single ? json(rows[0] ?? null) : json(rows, 200, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
  }
  if (url.includes('/rest/v1/rpc/')) return json(null);
  if (url.includes('/functions/v1/')) return json({});
  if (url.includes('/rest/v1/')) {
    if (method === 'HEAD') return req.respond({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, body: '' });
    return single ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([], 200, { 'content-range': '*/0' });
  }
  return json({});
}

const cardBox = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute('aria-label') || '').startsWith('Live event:'));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--host-resolver-rules=MAP *.supabase.co 127.0.0.1, MAP *.sentry.io 127.0.0.1, MAP *.posthog.com 127.0.0.1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: WEB_H, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.url().includes('supabase.co') ? answer(req) : req.continue()));
  await page.evaluateOnNewDocument((key, value) => {
    localStorage.setItem(key, value);
    // Keep the permission and "Your week" sheets out of the way: the recap
    // shows Monday to Wednesday, so most of the week Home has none.
    localStorage.setItem('@powr/notification_prompt_state', JSON.stringify({ lastPromptAt: Date.now(), dismissCount: 3, onboardingDeclinedAt: null }));
    const isoWeek = (date) => {
      const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const n = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - n);
      const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return `${d.getUTCFullYear()}-W${String(Math.ceil((((d - y) / 864e5) + 1) / 7)).padStart(2, '0')}`;
    };
    localStorage.setItem('@powr/weekly_recap_dismissed', isoWeek(new Date(Date.now() - 7 * 864e5)));
  }, 'sb-wjvvujnicwkruaeibttt-auth-token', JSON.stringify(session));

  await page.goto(`${APP}/(tabs)`, { waitUntil: 'load', timeout: 240000 });
  await new Promise((r) => setTimeout(r, 7000));

  // Development builds add a "DEV TOOLS" box that never ships.
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && (d.textContent || '').includes('DEV TOOLS'));
    let el = t;
    while (el && getComputedStyle(el).borderTopColor !== 'rgb(255, 255, 0)') el = el.parentElement;
    if (el) el.style.display = 'none';
  });

  // The safe area: pad Home's screen by the status bar as insets.top does on
  // a phone. Its background is absolutely placed, so it stays full height.
  await page.evaluate((inset) => {
    const pts = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && (d.textContent || '').trim() === 'pts');
    let el = pts;
    while (el && el.getBoundingClientRect().height < 600) el = el.parentElement;
    if (!el) return;
    el.style.paddingTop = `${inset}px`;
    // The sticky rings sit at top: insets.top + header height, set in code.
    for (const child of el.children) {
      const cs = getComputedStyle(child);
      if (cs.position === 'absolute' && cs.zIndex === '10') child.style.top = `${parseFloat(cs.top) + inset}px`;
    }
  }, STATUS_H);
  await new Promise((r) => setTimeout(r, 800));

  // Scroll until the card rests at CARD_TOP. The sticky rings slide in as
  // Home scrolls and move things, so settle it in a few passes.
  for (let pass = 0; pass < 5; pass++) {
    const box = await cardBox(page);
    if (!box) throw new Error('No live event card on Home: is the app on the branch with LiveEventCarousel?');
    if (Math.abs(box.y - CARD_TOP) < 1) break;
    await page.evaluate((dy) => {
      const card = [...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute('aria-label') || '').startsWith('Live event:'));
      let el = card;
      while (el && !(el.scrollHeight > el.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      if (el) { el.scrollTop += dy; el.dispatchEvent(new Event('scroll')); }
    }, box.y - CARD_TOP);
    await new Promise((r) => setTimeout(r, 1200));
  }
  const card = await cardBox(page);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute('aria-label') || '').startsWith('Live event:'));
    if (el) el.style.visibility = 'hidden';
  });
  await new Promise((r) => setTimeout(r, 400));

  fs.mkdirSync(path.dirname(OUT_IMG), { recursive: true });
  await page.screenshot({ path: OUT_IMG, type: 'webp', quality: 92, clip: { x: 0, y: 0, width: W, height: TOP_H } });
  const meta = {
    note: 'Written by landing-page/scripts/capture-app-home.cjs. The real Home, with the live event card cut out at `card`.',
    image: '/app-preview/home-event-backdrop.webp',
    width: W,
    height: TOP_H,
    status_h: STATUS_H,
    card: { x: Math.round(card.x), y: Math.round(card.y), w: Math.round(card.w), h: Math.round(card.h) },
    captured_at: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(meta, null, 2)}\n`);
  console.log('wrote', path.relative(ROOT, OUT_IMG), 'and', path.relative(ROOT, OUT_JSON), JSON.stringify(meta.card));
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
