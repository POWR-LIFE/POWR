/**
 * POWR landing-v2 design tokens.
 *
 * Two systems on purpose:
 *  - `pg` — the PAGE canvas. Mirrors the live landing page (style.css):
 *    near-black #080808, film grain, restrained glow. This is what makes
 *    the site read premium.
 *  - `t` — the APP surfaces. Mirrors constants/tokens.ts so anything that
 *    represents the product (phone screen, app cards) is pixel-faithful.
 * Do not mix them: page chrome uses pg, product UI uses t.
 */

// ── Page (landing site) ──
export const pg = {
  bg:        '#080808',
  surface1:  '#0F0F0F',
  border:    'rgba(255,255,255,0.08)',
  text:      '#F2F2F2',
  textSec:   'rgba(255,255,255,0.5)',
  textMuted: 'rgba(255,255,255,0.25)',
  accent:    '#E8D200',
  onAccent:  '#080808',
  // body::before grain from style.css — opacity 0.032, 180px tile
  grain:
    "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
};

// ── App (product) surfaces — constants/tokens.ts ──
export const t = {
  bg:        '#1E1E1E',
  surface1:  '#222222',
  surface2:  '#272727',
  border:    '#303030',
  borderCard:'rgba(255,255,255,0.08)',
  cardBg:    'rgba(40,40,40,0.85)',

  accent:    '#E8D200',
  onAccent:  '#0a0a0a',
  accentGlow:'rgba(232,210,0,0.08)',
  accentDim: 'rgba(232,210,0,0.12)',
  accentMid: 'rgba(232,210,0,0.25)',

  text:      '#F2F2F2',
  textSec:   'rgba(255,255,255,0.5)',
  textMuted: 'rgba(255,255,255,0.25)',
  dim:       'rgba(255,255,255,0.35)',

  success:   '#00CC66',
  warning:   '#FF9944',
  error:     '#CC3333',
  blue:      '#0EA5E9',

  // Activity colours (constants/activities.ts)
  actWalk:   '#4AF2A1',
  actRun:    '#FF9944',
  actCycle:  '#0EA5E9',
  actGym:    '#E8D200',
  actSleep:  '#6366F1',

  // League podium (app/(tabs)/league.tsx)
  gold:      '#E8D200',
  silver:    '#c0c0c0',
  bronze:    '#cd7f32',

  font: "'Outfit', system-ui, sans-serif",
};

// Outfit weights available from the Google Fonts link in index.html
export const w = {
  extraLight: 200,
  light:      300,
  regular:    400,
  medium:     500,
  semiBold:   600,
  bold:       700,
};
