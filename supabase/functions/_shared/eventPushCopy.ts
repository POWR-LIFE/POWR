// Wording of the one-off event pushes (live_event_send_template): the
// announcement to a venue's people, the kickoff and the finale-night morning
// to registrants. Shared so the gym portal's preview is word for word what
// members get:
//   - edge function (Deno): import { eventPushCopy } from '../_shared/eventPushCopy.ts'
//   - gym portal (Vite):    import { eventPushCopy } from '<repo>/supabase/functions/_shared/eventPushCopy.ts'
// The payload is _live_event_template_payload's jsonb (the portal gets the
// same object from gym_event_push_status). Pure: no imports, no I/O.

export type EventPushType = 'event_announced' | 'event_kickoff' | 'event_doors_open' | 'gym_quiet_nudge';

// "Wed 1 Oct" on the UK clock, or '' when missing.
export function ukDay(iso: unknown): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
  });
}

// "6pm" / "6:30pm" on the UK clock, or '' when missing.
export function ukTime(iso: unknown): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  const [h, m] = d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London',
  }).split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

// What a pick of activities reads as in a push, in the order the gym
// portal lists them. Walking brings daily steps with it (the event rules
// say so); a push only has room for "walks".
const ACTIVITY_NOUNS: [string, string][] = [
  ['gym', 'gym sessions'], ['running', 'runs'], ['cycling', 'rides'], ['swimming', 'swims'],
  ['hiit', 'HIIT workouts'], ['yoga', 'yoga sessions'], ['sports', 'sports sessions'],
  ['dance', 'dance sessions'], ['walking', 'walks'],
];

// "Every session at X counts" / "Runs and rides count" / "Every verified
// workout counts", without the full stop. activities is the event's
// included_activities (null = everything); venue_only comes first, and the
// gym portal never pairs it with a pick.
export function countsLine(payload: Record<string, unknown>, gym: string): string {
  if (payload.venue_only === true && gym) return `Every session at ${gym} counts`;
  const picked = Array.isArray(payload.activities) ? (payload.activities as unknown[]).map(String) : [];
  const words = ACTIVITY_NOUNS.filter(([key]) => picked.includes(key)).map(([, noun]) => noun);
  if (!words.length) return 'Every verified workout counts';
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `${list[0].toUpperCase()}${list.slice(1)} count`;
}

export function eventPushCopy(
  type: EventPushType,
  payload: Record<string, unknown>,
  now: number = Date.now(),
): { title: string; body: string } {
  const eventName = String(payload.event_name ?? '').trim();
  const gym = String(payload.gym_name ?? '').trim();

  switch (type) {
    case 'event_announced': {
      // Once per event, to the venue's members and recent visitors who
      // haven't joined. The gym picks the event, never the words.
      const name = eventName || 'A new event';
      const prize = String(payload.prize ?? '').trim();
      const starts = new Date(String(payload.starts_at ?? '')).getTime();
      const when = Number.isFinite(starts) && starts > now ? `Starts ${ukDay(payload.starts_at)}.` : 'On now.';
      const counts = `${countsLine(payload, gym)}.`;
      const named = gym && !name.toLowerCase().includes(gym.toLowerCase());
      return {
        title: named ? `New at ${gym}: ${name}` : `New: ${name}`,
        body: `${when} ${counts}${prize ? ` ${prize} for 1st.` : ''} Tap to join.`,
      };
    }
    case 'event_kickoff': {
      // Registrants, the morning scoring starts. ends_at is a midnight
      // boundary (half-open), so the last day that counts is the one before
      // it: minus one minute.
      const name = eventName || 'The event';
      const ends = new Date(String(payload.ends_at ?? '')).getTime();
      const lastDay = Number.isFinite(ends) ? ukDay(new Date(ends - 60_000).toISOString()) : '';
      const counts = countsLine(payload, gym);
      return {
        title: `${name}: it's on 🏁`,
        body: `${counts}${lastDay ? ` until ${lastDay}` : ''}. The board is open.`,
      };
    }
    case 'gym_quiet_nudge': {
      // A gym's members who share their activity with it and have gone
      // quiet, on the gym's press (gym_nudge_quiet). POWR's words, never
      // the gym's. `weeks` is since their last session, when known.
      const weeks = Math.max(0, Math.round(Number(payload.weeks ?? 0)));
      const since = weeks >= 2 ? `It’s been ${weeks} weeks.` : 'It’s been a while.';
      return {
        title: gym ? `${gym}: your spot’s still here` : 'Your spot’s still here',
        body: `${since} One check-in and you’re back on the board.`,
      };
    }
    case 'event_doors_open': {
      // Registrants, the morning of the finale night. The attendance reward
      // is paid to members the venue geofence sees during the night, so
      // "check in" is the ask.
      const name = eventName || 'The event';
      const time = ukTime(payload.doors_open_at);
      const bonus = Math.max(0, Math.round(Number(payload.attendance ?? 0)));
      return {
        title: `${name}: finale night is tonight`,
        body: `Doors open ${time || 'tonight'}${gym ? ` at ${gym}` : ''}.`
          + (bonus > 0 ? ` Check in with POWR when you arrive for +${bonus} POWR.` : ''),
      };
    }
  }
}
