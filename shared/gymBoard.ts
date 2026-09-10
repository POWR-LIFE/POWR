/**
 * Gym big-screen board — pure helpers shared by the display page
 * (landing-page/src/pages/GymBoard.jsx) and the admin panel.
 * No React, no network: everything here is unit-testable.
 */

export type BoardRow = {
  key: string;
  rank: number;
  points: number;
  sessions: number;
  rank_delta?: number | null;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

/** URL slug for a gym: lower-case, dashes, nothing else. */
export function gymSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** Unguessable display token — 48 hex chars, matches the live-event shape. */
export function newDisplayToken(random: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(24);
  random(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The board's URL. `origin` defaults to the canonical host the gym receives;
 *  pass the admin's own origin for Open/Preview so they work from localhost
 *  and Vercel branch previews before the route is on powr.life. */
export function boardUrl(slug: string, token: string, preview?: string | null, origin = 'https://powr.life'): string {
  const base = `${origin.replace(/\/+$/, '')}/gym/${slug}?k=${token}`;
  return preview ? `${base}&preview=${preview}` : base;
}

/** Name as the screen shows it. Never a user id, never an email. */
export function boardName(row: { display_name?: string | null; username?: string | null }): string {
  return row.display_name || row.username || 'POWR member';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** "Mon 7 – Sun 13 Sep" / "Mon 28 Sep – Sun 4 Oct" in the board's own zone. */
export function weekLabel(startIso: string, endIso: string, tz: string, locale = 'en-GB'): string {
  const start = new Date(startIso);
  // The window is half-open; the last day that counts is a minute before it closes.
  const last = new Date(new Date(endIso).getTime() - 60_000);
  const day = (d: Date, withMonth: boolean) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
    }).format(d);
  const monthOf = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short' }).format(d);
  const sameMonth = monthOf(start) === monthOf(last);
  return `${day(start, !sameMonth)} – ${day(last, true)}`;
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number; totalMs: number };

export function countdownParts(targetIso: string, nowMs: number): CountdownParts {
  const totalMs = Math.max(0, new Date(targetIso).getTime() - nowMs);
  return {
    days: Math.floor(totalMs / 86_400_000),
    hours: Math.floor((totalMs % 86_400_000) / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    seconds: Math.floor((totalMs % 60_000) / 1000),
    totalMs,
  };
}

/** "2d 14h" / "14h 06m" / "06m 12s" — the reset clock reads at one glance. */
export function resetLabel(parts: CountdownParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (parts.days > 0) return `${parts.days}d ${pad(parts.hours)}h`;
  if (parts.hours > 0) return `${parts.hours}h ${pad(parts.minutes)}m`;
  return `${pad(parts.minutes)}m ${pad(parts.seconds)}s`;
}

/** Split standings into the podium (1–3), the list (4–N) and the ticker (N+1…). */
export function splitStandings(rows: BoardRow[], listSize = 7): { podium: BoardRow[]; list: BoardRow[]; rest: BoardRow[] } {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return {
    podium: sorted.slice(0, 3),
    list: sorted.slice(3, 3 + listSize),
    rest: sorted.slice(3 + listSize),
  };
}

/** Width of a row's bar as a fraction of the leader's points (0–1). */
export function barFraction(points: number, leaderPoints: number): number {
  if (leaderPoints <= 0 || points <= 0) return 0;
  return Math.max(0.04, Math.min(1, points / leaderPoints));
}

/** Root font-size that scales a 1920×1080 design to any TV (16px at 1080p). */
export function rootFontSize(width: number, height: number, base = 16): number {
  const scale = Math.min(width / 1920, height / 1080);
  return Math.round(Math.min(40, Math.max(9, base * scale)) * 100) / 100;
}

/** Sample rows for the admin preview — obviously fake, never mistaken for real scores. */
export function sampleStandings(n: number): BoardRow[] {
  const names = [
    'Alex P.', 'Jordan R.', 'Sam T.', 'Charlie M.', 'Taylor B.', 'Morgan K.', 'Riley S.', 'Casey D.',
    'Jamie W.', 'Drew H.', 'Robin F.', 'Quinn L.', 'Avery N.', 'Skyler J.', 'Reese C.', 'Rowan G.',
    'Emerson V.', 'Finley O.', 'Harper E.', 'Kendall A.', 'Logan I.', 'Marley U.', 'Noel Y.', 'Parker Z.',
  ];
  const deltas = [0, 2, -1, 1, 0, 3, -2, 0, 1, -1, 0, 2];
  return names.slice(0, n).map((name, i) => ({
    key: `sample-${i}`,
    rank: i + 1,
    points: 1240 - i * 61 - (i % 3) * 17,
    sessions: Math.max(1, 6 - Math.floor(i / 3)),
    rank_delta: deltas[i % deltas.length],
    display_name: name,
    username: null,
    avatar_url: null,
  }));
}
