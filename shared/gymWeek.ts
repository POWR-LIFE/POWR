// This week at a gym, read the way an owner would: is it a good week, where
// is it heading, and is there still time to do something about it. The
// gym portal Overview's "This week" card.
//
//   usual      a normal week: the last 4 complete weeks' average (Clash+), else last week
//   best       the busiest of the last 8 complete weeks (Clash+)
//   projected  where the week is heading: sessions so far, plus what the
//              days still to come usually bring (by weekday, last 4 weeks;
//              else last week's same days), plus what today usually brings
//              beyond what it has already
//   rush       the busiest two hours of the day, last 4 weeks
//   headline   one sentence that says which of those matters this week
//
// Pure, from what the Overview already loads (gym_portal_summary and
// gym_insights). Under jest (__tests__/gymWeek.test.ts).

export type DayPoint = { day: string; sessions: number; athletes?: number };

export type WeekInput = {
  /** gym_portal_summary.days: 14 local days, last week's Monday first. */
  days: DayPoint[] | null | undefined;
  /** Today in the gym's time, YYYY-MM-DD. */
  todayIso: string;
  /** Sessions this week so far, and last week's total. */
  soFar: number;
  lastWeek: number;
  /** gym_insights.weeks, oldest first; the last one is this week (Clash+). */
  weeks?: Array<{ sessions: number }> | null;
  /** gym_insights.days: sessions by weekday over the last 28 days, Monday first (Clash+). */
  weekdays?: number[] | null;
  /** gym_insights.hours: sessions by local start hour over the last 28 days (Clash+). */
  hours?: number[] | null;
};

export type WeekStory = {
  /** 0 = Monday. */
  dayIndex: number;
  soFar: number;
  usual: number | null;
  /** Where `usual` came from: the last four weeks, or last week alone. */
  usualFrom: 'four' | 'last' | null;
  projected: number | null;
  best: number | null;
  /** How many complete weeks `best` was taken over. */
  bestOf: number;
  headline: string;
  tone: 'up' | 'down' | 'even' | 'new';
  rush: { from: number; to: number } | null;
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PLURAL_DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

/** "5pm", "12pm", "7am": the wall's own hour labels. */
export function hourName(h: number): string {
  const x = ((h % 24) + 24) % 24;
  if (x === 0) return '12am';
  if (x === 12) return '12pm';
  return x < 12 ? `${x}am` : `${x - 12}pm`;
}

/** The busiest two-hour stretch, when there's enough to say so (20+ sessions in 4 weeks). */
export function rushOf(hours: number[] | null | undefined): { from: number; to: number } | null {
  if (!hours || hours.length !== 24) return null;
  if (hours.reduce((s, n) => s + n, 0) < 20) return null;
  let best = 0;
  for (let h = 1; h < 23; h++) if (hours[h] + hours[h + 1] > hours[best] + hours[best + 1]) best = h;
  return { from: best, to: best + 2 };
}

export function weekStory(i: WeekInput): WeekStory {
  const days = i.days && i.days.length >= 14 ? i.days : null;
  const thisWeek = days ? days.slice(7) : [];
  const lastWeek = days ? days.slice(0, 7) : [];
  const found = thisWeek.findIndex((d) => d.day === i.todayIso);
  const dayIndex = found >= 0 ? found : 0;

  // A normal week, and the best of the last eight.
  const complete = (i.weeks ?? []).slice(0, -1).map((w) => w.sessions ?? 0);
  const recent = complete.slice(-4);
  let usual: number | null = null;
  let usualFrom: WeekStory['usualFrom'] = null;
  if (recent.length === 4 && recent.some((n) => n > 0)) {
    usual = Math.round(recent.reduce((s, n) => s + n, 0) / 4);
    usualFrom = 'four';
  } else if (i.lastWeek > 0) {
    usual = i.lastWeek;
    usualFrom = 'last';
  }
  const eight = complete.slice(-8);
  const best = eight.length >= 4 && eight.some((n) => n > 0) ? Math.max(...eight) : null;

  // What each weekday usually brings: the last four weeks by weekday, else last week's same day.
  const typical: number[] | null = i.weekdays && i.weekdays.length === 7 && i.weekdays.some((n) => n > 0)
    ? i.weekdays.map((n) => n / 4)
    : lastWeek.length === 7 ? lastWeek.map((d) => d.sessions) : null;
  let projected: number | null = null;
  if (typical && days) {
    const today = thisWeek[dayIndex]?.sessions ?? 0;
    const rest = typical.slice(dayIndex + 1).reduce((s, n) => s + n, 0);
    projected = Math.round(i.soFar + Math.max(0, typical[dayIndex] - today) + rest);
  }

  // Which weekday still to come is usually the busiest (for a slow start).
  const ahead = typical
    ? typical.map((n, d) => ({ n, d })).filter((x) => x.d > dayIndex).sort((a, b) => b.n - a.n)[0]
    : undefined;
  const busiest = typical ? typical.indexOf(Math.max(...typical)) : -1;

  let headline: string;
  let tone: WeekStory['tone'];
  if (i.soFar === 0) {
    // Amber only for a gym that usually has sessions by now; a new one isn't behind anything.
    tone = dayIndex > 0 && usual ? 'down' : 'new';
    headline = dayIndex === 0
      ? (usual ? `New week. A usual one here is about ${usual} sessions.` : 'New week. The board starts again today.')
      : usual ? 'No check-ins yet this week.' : 'No check-ins yet. Each session shows up here as members train.';
  } else if (best != null && i.soFar > best) {
    tone = 'up';
    headline = dayIndex < 6
      ? `Your busiest week in ${eight.length} weeks already, and it’s only ${WEEKDAYS[dayIndex]}.`
      : `Your busiest week in ${eight.length} weeks.`;
  } else if (best != null && projected != null && projected > best && dayIndex < 6) {
    tone = 'up';
    headline = `On course for your busiest week in ${eight.length} weeks.`;
  } else if (usual && projected != null) {
    const ratio = projected / usual;
    if (ratio >= 1.1) {
      tone = 'up';
      headline = dayIndex < 6 ? `Busier than usual: on course for about ${projected}.` : `A busier week than usual: ${i.soFar} against about ${usual}.`;
    } else if (ratio <= 0.9) {
      tone = 'down';
      headline = ahead && ahead.d === busiest && ahead.n > 0
        ? `Quieter than usual so far. ${PLURAL_DAYS[ahead.d]} are your busiest, and it’s still to come.`
        : dayIndex < 6 ? `Quieter than usual: on course for about ${projected}.` : `A quieter week than usual: ${i.soFar} against about ${usual}.`;
    } else {
      tone = 'even';
      headline = dayIndex < 6 ? `A normal week so far: on course for about ${projected}.` : `A normal week: ${i.soFar} against about ${usual}.`;
    }
  } else {
    tone = 'even';
    headline = `${i.soFar} session${i.soFar === 1 ? '' : 's'} so far this week.`;
  }

  return { dayIndex, soFar: i.soFar, usual, usualFrom, projected, best, bestOf: eight.length, headline, tone, rush: rushOf(i.hours) };
}
