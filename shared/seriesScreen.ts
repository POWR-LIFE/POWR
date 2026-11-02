/**
 * Series screen — pure helpers shared by the TV page
 * (landing-page/src/pages/SeriesScreen.jsx) and the admin Series page's
 * Screens tab. No React, no network: everything here is unit-testable.
 *
 * ONE screen for every TV (powr.life/series-tv?k=<key>): the POWR Series as a
 * reel — the countdown to the round, how it works, the seven prizes, Squad
 * Builder, and the QR code to join. It is not tied to a gym: nothing on it is
 * per gym or per member. The key, the on/off switch and the city it names
 * live in system_config (series_screen_key / series_screen / series_screen_city)
 * and are run from /admin/series → Screens. Everything it says comes from the
 * Series tables (season, round dates, prizes, the start-line crowd), so the
 * screen follows the calendar on its own.
 */

export type SeriesScreenSeason = {
  slug: string;
  name: string;
  look: string;
  number: number;
  code: string | null;
};

export type SeriesScreenRound = {
  slug: string;
  name: string;
  starts_at: string;
  /** Exclusive: midnight after the round's last day. */
  ends_at: string;
  invite_from: string | null;
  draw_days: number;
};

export type SeriesScreenPrize = {
  kind: string;
  place: number | null;
  name: string;
  sponsor: string | null;
  detail: string | null;
  winners: number;
};

/** The start-line crowd, as get_series_invite_board hands it to the app. */
export type SeriesScreenCrowd = {
  real: number;
  pacers_at_gun: number;
  ramp_from: string;
  ramp_to: string;
  base: number;
};

export type SeriesScreenPayload = {
  tz: string;
  /** The city the screen speaks for ("all of London"); null = no city named. */
  city: string | null;
  season: SeriesScreenSeason | null;
  round: SeriesScreenRound | null;
  next_round: SeriesScreenRound | null;
  prizes: SeriesScreenPrize[];
  crowd: SeriesScreenCrowd | null;
  join_url: string;
  generated_at: string;
};

/** Where the QR sends a phone: the Series page redirects to the app or the store. */
export const SERIES_JOIN_URL = 'https://powr.life/series';

/**
 * The screen's URL. One segment on purpose, and not under /series/: vercel.json
 * rewrites /series/<anything> to the invite-link preview (series-invite-og).
 */
export function seriesScreenUrl(key: string, preview?: string | null, origin = 'https://powr.life'): string {
  const base = `${origin.replace(/\/+$/, '')}/series-tv?k=${key}`;
  return preview ? `${base}&preview=${preview}` : base;
}

/** system_config keys behind the screen. */
export const SCREEN_CONFIG_KEYS = ['series_screen', 'series_screen_key', 'series_screen_city'] as const;

/** A fresh, unguessable link key: 48 hex characters from the caller's random source. */
export function newScreenKey(random: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(24);
  random(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type SeriesPhase = 'before' | 'live' | 'after';

export function roundPhase(round: Pick<SeriesScreenRound, 'starts_at' | 'ends_at'>, nowMs: number): SeriesPhase {
  if (nowMs < Date.parse(round.starts_at)) return 'before';
  if (nowMs < Date.parse(round.ends_at)) return 'live';
  return 'after';
}

const DAY_MS = 86_400_000;

function parts(iso: string | number, tz: string): { weekday: string; day: string; month: string; monthLong: string } {
  const d = new Date(iso);
  const get = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(d);
  return {
    weekday: get({ weekday: 'short' }),
    day: get({ day: 'numeric' }),
    month: get({ month: 'short' }),
    monthLong: get({ month: 'long' }),
  };
}

/** "Sun 15 Nov" */
export function weekdayDate(iso: string | number, tz: string): string {
  const p = parts(iso, tz);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "15 Nov" */
export function shortDate(iso: string | number, tz: string): string {
  const p = parts(iso, tz);
  return `${p.day} ${p.month}`;
}

/** "November" — the month the round starts in, for "Best newcomer this November". */
export function monthOf(iso: string | number, tz: string): string {
  return parts(iso, tz).monthLong;
}

/**
 * "15–30 Nov" or "26 Oct–15 Nov": an inclusive run of days. `toIso` is the
 * LAST day shown, so pass ends_at minus a moment for a round's window.
 */
export function dateRange(fromIso: string | number, toIso: string | number, tz: string): string {
  const a = parts(fromIso, tz);
  const b = parts(toIso, tz);
  if (a.month === b.month) return a.day === b.day ? `${a.day} ${a.month}` : `${a.day}–${b.day} ${b.month}`;
  return `${a.day} ${a.month}–${b.day} ${b.month}`;
}

/** The round's days as people say them: "15–30 Nov" (ends_at is the midnight after). */
export function roundWindow(round: Pick<SeriesScreenRound, 'starts_at' | 'ends_at'>, tz: string): string {
  return dateRange(round.starts_at, Date.parse(round.ends_at) - 1, tz);
}

/**
 * The build-up — the invite race before the gun. From invite_from when the
 * admin opened it, else the server's own fallback of two weeks before.
 */
export function buildUpWindow(round: Pick<SeriesScreenRound, 'starts_at' | 'invite_from'>, tz: string): string {
  const from = round.invite_from ? Date.parse(round.invite_from) : Date.parse(round.starts_at) - 14 * DAY_MS;
  return dateRange(from, round.starts_at, tz);
}

export type SeriesClock = {
  phase: SeriesPhase;
  /** "To Round 01" · "Round 01 · Live" · "Round 01 · Complete" */
  label: string;
  /** "Starts Sun 15 Nov" · "Ends Mon 30 Nov, midnight" · "Winners announced soon" */
  when: string;
  /** What the digits count down to; null when there is nothing left to count. */
  targetMs: number | null;
};

/** What the rail's clock says and counts to, for this round (and the one after, once it has ended). */
export function seriesClock(
  round: SeriesScreenRound | null,
  next: SeriesScreenRound | null,
  nowMs: number,
  tz: string,
): SeriesClock {
  if (!round) return { phase: 'after', label: 'Next round', when: 'Announced soon', targetMs: null };
  const phase = roundPhase(round, nowMs);
  if (phase === 'before') {
    return { phase, label: `To ${round.name}`, when: `Starts ${weekdayDate(round.starts_at, tz)}`, targetMs: Date.parse(round.starts_at) };
  }
  if (phase === 'live') {
    return {
      phase,
      label: `${round.name} · Live`,
      when: `Ends ${weekdayDate(Date.parse(round.ends_at) - 1, tz)}, midnight`,
      targetMs: Date.parse(round.ends_at),
    };
  }
  if (next && Date.parse(next.starts_at) > nowMs) {
    return { phase, label: `To ${next.name}`, when: `Starts ${weekdayDate(next.starts_at, tz)}`, targetMs: Date.parse(next.starts_at) };
  }
  return { phase, label: `${round.name} · Complete`, when: 'Winners announced soon', targetMs: null };
}

export type CountdownDigits = { days: string; hours: string; minutes: string; seconds: string };

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

/** Zero-padded digits for the rail. Days may run past 99 (a season away). */
export function countdownDigits(targetMs: number | null, nowMs: number): CountdownDigits {
  const s = targetMs === null ? 0 : Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    days: pad2(Math.floor(s / 86_400)),
    hours: pad2(Math.floor((s % 86_400) / 3_600)),
    minutes: pad2(Math.floor((s % 3_600) / 60)),
    seconds: pad2(s % 60),
  };
}

/**
 * How many are waiting at the start line at time `t`: the server's ramp,
 * worked out per second — the same sum the app shows (lib/api/series.ts),
 * so the TV and the phone in front of it agree.
 */
export function crowdAt(crowd: SeriesScreenCrowd | null, nowMs: number): number | null {
  if (!crowd) return null;
  const from = Date.parse(crowd.ramp_from);
  const to = Date.parse(crowd.ramp_to);
  const p = to > from ? Math.min(1, Math.max(0, (nowMs - from) / (to - from))) : 1;
  return crowd.real + Math.round(crowd.pacers_at_gun * (crowd.base + (1 - crowd.base) * p));
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-GB');

/**
 * The seven ways to win, in the order the prizes scene shows them. Kinds are
 * series_prizes.kind; the words are the app's (Champion / Contender /
 * Challenger · Unbreakable · Level Up · Rookie of the Series · Squad Builder).
 * `reveal` = days after the gun that the prize behind it is announced, one a
 * day from the first day of the round, biggest last. Squad Builder is its
 * own race during the build-up, so its prize is named up front.
 */
export type PrizeSlot = {
  key: string;
  kind: string;
  place: number | null;
  ord: number;
  title: string;
  how: string;
  reveal: number | null;
};

export const PRIZE_SLOTS: readonly PrizeSlot[] = [
  { key: 'place-1', kind: 'place', place: 1, ord: 1, title: 'Champion', how: 'Gold · Most points', reveal: 5 },
  { key: 'place-2', kind: 'place', place: 2, ord: 2, title: 'Contender', how: 'Silver · Second-most points', reveal: 4 },
  { key: 'place-3', kind: 'place', place: 3, ord: 3, title: 'Challenger', how: 'Bronze · Third-most points', reveal: 3 },
  { key: 'hot_streak', kind: 'hot_streak', place: null, ord: 4, title: 'Unbreakable', how: 'Longest streak of active days', reveal: 2 },
  { key: 'biggest_mover', kind: 'biggest_mover', place: null, ord: 5, title: 'Level Up', how: 'Climb the most places', reveal: 1 },
  { key: 'rookie', kind: 'rookie', place: null, ord: 6, title: 'Rookie of the Series', how: 'Best newcomer this {month}', reveal: 0 },
  { key: 'patient_zero', kind: 'patient_zero', place: null, ord: 7, title: 'Squad Builder', how: 'Recruit the most active friends', reveal: null },
];

/** A prize row saved as a stand-in ("Prize to be announced") is not a prize yet. */
export function isPlaceholderPrize(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return /to be announced|to be confirmed|announced soon|\btba\b|\btbc\b/i.test(name);
}

export function prizeFor(slot: PrizeSlot, prizes: SeriesScreenPrize[]): SeriesScreenPrize | null {
  return prizes.find((p) => p.kind === slot.kind && (slot.kind !== 'place' || p.place === slot.place)) ?? null;
}

export type PrizeChip = { text: string; on: boolean };

/**
 * The small chip under each prize: the prize itself once it is in the
 * system, else when it will be. A reveal day that has passed with nothing
 * entered says "Announced soon" rather than a date in the past.
 */
export function prizeChip(
  slot: PrizeSlot,
  prizes: SeriesScreenPrize[],
  round: Pick<SeriesScreenRound, 'starts_at'> | null,
  nowMs: number,
  tz: string,
): PrizeChip {
  const row = prizeFor(slot, prizes);
  if (row && !isPlaceholderPrize(row.name)) return { text: row.name, on: true };
  if (slot.reveal !== null && round) {
    const revealMs = Date.parse(round.starts_at) + slot.reveal * DAY_MS;
    if (nowMs < revealMs) return { text: `Revealed ${shortDate(revealMs, tz)}`, on: false };
  }
  return { text: 'Announced soon', on: false };
}

/** Number as the lockup prints it: 1 → "001". */
export function seriesNumber(n: number | null | undefined): string {
  return String(Math.max(0, n ?? 0)).padStart(3, '0');
}

/**
 * Sample payload for ?preview=sample: the Autumn Series calendar as seeded, one
 * prize named so the chip states show, a sample crowd.
 */
export function sampleSeriesScreen(nowMs: number): SeriesScreenPayload {
  const starts = Date.UTC(2026, 10, 15);
  const ends = Date.UTC(2026, 11, 1);
  return {
    tz: 'Europe/London',
    city: 'London',
    season: { slug: 'autumn-26', name: 'Autumn Series', look: 'autumn', number: 1, code: 'AS26' },
    round: {
      slug: 'autumn-01',
      name: 'Round 01',
      starts_at: new Date(starts).toISOString(),
      ends_at: new Date(ends).toISOString(),
      invite_from: new Date(Date.UTC(2026, 9, 26, 15, 1)).toISOString(),
      draw_days: 10,
    },
    next_round: {
      slug: 'autumn-02',
      name: 'Round 02',
      starts_at: new Date(Date.UTC(2026, 11, 15)).toISOString(),
      ends_at: new Date(Date.UTC(2027, 0, 1)).toISOString(),
      invite_from: null,
      draw_days: 10,
    },
    prizes: [{ kind: 'patient_zero', place: null, name: 'Theragun Prime', sponsor: null, detail: null, winners: 1 }],
    crowd: {
      real: 131,
      pacers_at_gun: 1369,
      ramp_from: new Date(Date.UTC(2026, 9, 26, 15, 1)).toISOString(),
      ramp_to: new Date(starts).toISOString(),
      base: 0.835,
    },
    join_url: SERIES_JOIN_URL,
    generated_at: new Date(nowMs).toISOString(),
  };
}
