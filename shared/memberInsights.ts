// What a gym's members' activity says, and what to do about it — the gym
// portal's "The data" card (after the Gym Clash packages sheet: "Running is up
// 30% among members → Launch a run club. We bring the sponsor.").
//
// Input is gym_member_activity(): anonymous numbers across the members who
// picked the gym, their activity anywhere, never sleep / heart rate / steps.
// Pure functions, under jest (__tests__/memberInsights.test.ts); the portal
// only renders what these return.

export type MixRow = {
  type: string;
  members: number;
  sessions: number;
  minutes?: number;
  km?: number;
  prev_sessions?: number;
  /** Sessions per active member, last 4 complete weeks vs the 4 before, in %. */
  change_pct: number | null;
};

export type MemberActivity = {
  members: number;
  too_few?: boolean;
  min_members?: number;
  active_4w?: number;
  active_prev_4w?: number;
  mix?: MixRow[];
  segments?: Array<{ type: string; members: number }>;
  consistency?: { none: number; low: number; mid: number; high: number };
  weekdays?: number[];
  months?: Array<{ month: string; active_members: number; sessions: number }>;
  gym_sessions?: { here: number; other_gyms: number; elsewhere: number };
  quiet?: number;
  slowing?: number;
  sharing?: number;
};

export type Insight = {
  key: string;
  finding: string;
  action: string;
  tone: 'up' | 'down' | 'watch';
};

/** The activity as a subject: "Running is up…", "Gym training is down…". */
export const ACTIVITY_NOUN: Record<string, string> = {
  running: 'Running',
  cycling: 'Cycling',
  gym: 'Gym training',
  hiit: 'HIIT',
  swimming: 'Swimming',
  yoga: 'Yoga',
  sports: 'Sport',
  dance: 'Dance',
  walking: 'Walking',
};

const RISE_ACTION: Record<string, string> = {
  running: 'Launch a run club. We bring the sponsor.',
  cycling: 'Start a weekend ride from the gym.',
  swimming: 'Run a swim-and-lift challenge.',
  hiit: 'Put another HIIT class at your busiest hour.',
  yoga: 'Add a mobility or yoga session.',
  walking: 'Add beginner strength classes.',
  gym: 'Run a monthly challenge that only counts sessions at your gym.',
};

const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const noun = (type: string) => ACTIVITY_NOUN[type] ?? type.charAt(0).toUpperCase() + type.slice(1);

/**
 * Up to `limit` findings, most useful first: members going quiet (retention),
 * the biggest rise, heavy walkers vs light lifters, training at other gyms,
 * the biggest fall, a weak weekday, a seasonal dip, the committed core.
 * Nothing when the gym is below the member threshold.
 */
export function memberInsights(
  a: MemberActivity | null | undefined,
  opts: { gymName: string; canSeePeople: boolean; limit?: number },
): Insight[] {
  if (!a || a.too_few) return [];
  const out: Insight[] = [];
  // An activity only speaks for "members" once 3+ did it and there's enough of it.
  const mix = (a.mix ?? []).filter((r) => r.members >= 3 && r.sessions >= 8);

  const quiet = a.quiet ?? 0;
  const slowing = a.slowing ?? 0;
  if (quiet + slowing > 0) {
    const finding = quiet > 0
      ? `${quiet} member${quiet === 1 ? ' has' : 's have'} gone quiet${slowing ? `, and ${slowing} more ${slowing === 1 ? 'is' : 'are'} slowing down` : ''}`
      : `${slowing} member${slowing === 1 ? ' is' : 's are'} slowing down`;
    out.push({
      key: 'quiet',
      finding,
      action: opts.canSeePeople ? 'Reach out before they cancel. See who below.' : 'Reach out before they cancel. Clash Pro shows you who.',
      tone: 'watch',
    });
  }

  const riser = mix
    .filter((r) => r.change_pct != null && r.change_pct >= 25)
    .sort((x, y) => (y.change_pct ?? 0) - (x.change_pct ?? 0))[0];
  if (riser) {
    out.push({
      key: `up:${riser.type}`,
      finding: `${noun(riser.type)} is up ${riser.change_pct}% among members`,
      action: RISE_ACTION[riser.type] ?? 'Build a challenge around it.',
      tone: 'up',
    });
  }

  const walk = mix.find((r) => r.type === 'walking');
  const lift = mix.find((r) => r.type === 'gym');
  if (walk && walk.members >= 5 && walk.members > 1.5 * (lift?.members ?? 0)) {
    out.push({ key: 'walkers', finding: 'Heavy walkers, light lifters', action: 'Add beginner strength classes.', tone: 'up' });
  }

  const g = a.gym_sessions;
  if (g && g.other_gyms >= 5) {
    const placed = g.here + g.other_gyms;
    const share = placed ? g.other_gyms / placed : 0;
    if (share >= 0.2) {
      out.push({
        key: 'elsewhere',
        finding: `${Math.round(share * 100)}% of their gym check-ins are at other gyms`,
        action: `Give them a reason to train here: a monthly challenge that only counts sessions at ${opts.gymName}.`,
        tone: 'down',
      });
    }
  }

  const faller = mix
    .filter((r) => r.change_pct != null && r.change_pct <= -25)
    .sort((x, y) => (x.change_pct ?? 0) - (y.change_pct ?? 0))[0];
  if (faller) {
    out.push({
      key: `down:${faller.type}`,
      finding: `${noun(faller.type)} is down ${Math.abs(faller.change_pct ?? 0)}% among members`,
      action: 'Win it back with a challenge built around it.',
      tone: 'down',
    });
  }

  const wd = a.weekdays ?? [];
  const total = wd.reduce((s, n) => s + n, 0);
  if (wd.length === 7 && total >= 50) {
    const mean = total / 7;
    const low = wd.indexOf(Math.min(...wd));
    if (wd[low] < 0.7 * mean) {
      out.push({
        key: 'weekday',
        finding: `Training dips on ${WEEKDAYS[low]}`,
        action: `Put a class or a challenge day on ${WEEKDAYS[low]}.`,
        tone: 'down',
      });
    }
  }

  // Seasonal: complete months with 5+ active members, per active member.
  const months = (a.months ?? []).slice(0, -1).filter((m) => m.active_members >= 5);
  if (months.length >= 4) {
    const rates = months.map((m) => m.sessions / m.active_members);
    const low = rates.indexOf(Math.min(...rates));
    const others = rates.filter((_, i) => i !== low);
    const avg = others.reduce((s, r) => s + r, 0) / others.length;
    if (rates[low] < 0.75 * avg) {
      const month = MONTHS[Number(months[low].month.slice(5, 7)) - 1];
      out.push({ key: 'month', finding: `Consistency dipped in ${month}`, action: 'Book a Clash Night exactly then.', tone: 'down' });
    }
  }

  const c = a.consistency;
  const active = a.active_4w ?? 0;
  if (c && active >= 5 && c.high / active >= 0.4) {
    out.push({
      key: 'core',
      finding: `${c.high} of your members train 5+ days a week`,
      action: 'Give them a stage: a leaderboard challenge they can win.',
      tone: 'up',
    });
  }

  return out.slice(0, opts.limit ?? 3);
}

/** "+91%" / "−12%" / "" for a per-member change. */
export function changeLabel(pct: number | null | undefined): string {
  if (pct == null) return '';
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : '0%';
}
