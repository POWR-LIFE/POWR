// Wording of the one-off event pushes (live_event_send_template): the
// announcement to a venue's people, the kickoff and the finale-night morning
// to registrants. Shared so the gym portal's preview is word for word what
// members get:
//   - edge function (Deno): import { eventPushCopy } from '../_shared/eventPushCopy.ts'
//   - gym portal (Vite):    import { eventPushCopy } from '<repo>/supabase/functions/_shared/eventPushCopy.ts'
// The payload is _live_event_template_payload's jsonb (the portal gets the
// same object from gym_event_push_status). Pure: no I/O.
//
// Every function takes a trailing `lang` (default 'en'): send-push passes the
// member's language; the portal passes nothing, so its previews stay English.
// The words live in _shared/i18n/push/<lang>.ts under `event.*`.

import { formatLocale, tPush } from './i18n/index.ts';

export type EventPushType = 'event_announced' | 'event_kickoff' | 'event_doors_open' | 'gym_quiet_nudge' | 'gym_on_powr';

// "Wed 1 Oct" on the UK clock, or '' when missing. French and Spanish spell
// it out ("mercredi 1 octobre", "miércoles, 1 de octubre"): their short forms
// end in a full stop ("mer. 1 oct.") that collides with the sentence's own.
export function ukDay(iso: unknown, lang = 'en'): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(formatLocale(lang), lang === 'en'
    ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }
    : { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}

// "6pm" / "6:30pm" on the UK clock, or '' when missing. Other languages read
// the 24-hour clock ("18:00", "18:30").
export function ukTime(iso: unknown, lang = 'en'): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  const clock = d.toLocaleTimeString(lang === 'en' ? 'en-GB' : formatLocale(lang), {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London',
  });
  if (lang !== 'en') return clock;
  const [h, m] = clock.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

// What a pick of activities reads as in a push, in the order the gym
// portal lists them. Walking brings daily steps with it (the event rules
// say so); a push only has room for "walks".
const ACTIVITY_ORDER = ['gym', 'running', 'cycling', 'swimming', 'hiit', 'yoga', 'sports', 'dance', 'walking'];

function activityNoun(lang: string, key: string): string {
  switch (key) {
    case 'gym': return tPush(lang, 'event.activities.gym');
    case 'running': return tPush(lang, 'event.activities.running');
    case 'cycling': return tPush(lang, 'event.activities.cycling');
    case 'swimming': return tPush(lang, 'event.activities.swimming');
    case 'hiit': return tPush(lang, 'event.activities.hiit');
    case 'yoga': return tPush(lang, 'event.activities.yoga');
    case 'sports': return tPush(lang, 'event.activities.sports');
    case 'dance': return tPush(lang, 'event.activities.dance');
    default: return tPush(lang, 'event.activities.walking');
  }
}

// "Every session at X counts" / "Runs and rides count" / "Every verified
// workout counts", without the full stop. activities is the event's
// included_activities (null = everything); venue_only comes first, and the
// gym portal never pairs it with a pick.
export function countsLine(payload: Record<string, unknown>, gym: string, lang = 'en'): string {
  if (payload.venue_only === true && gym) return tPush(lang, 'event.counts.venue', { gym });
  const picked = Array.isArray(payload.activities) ? (payload.activities as unknown[]).map(String) : [];
  const words = ACTIVITY_ORDER.filter((key) => picked.includes(key)).map((key) => activityNoun(lang, key));
  if (!words.length) return tPush(lang, 'event.counts.any');
  const list = words.length === 1
    ? words[0]
    : tPush(lang, 'event.counts.list', { head: words.slice(0, -1).join(', '), last: words[words.length - 1] });
  const line = tPush(lang, 'event.counts.picked', { list });
  return `${line[0].toUpperCase()}${line.slice(1)}`;
}

export function eventPushCopy(
  type: EventPushType,
  payload: Record<string, unknown>,
  now: number = Date.now(),
  lang = 'en',
): { title: string; body: string } {
  const eventName = String(payload.event_name ?? '').trim();
  const gym = String(payload.gym_name ?? '').trim();

  switch (type) {
    case 'event_announced': {
      // Once per event, to the venue's members and recent visitors who
      // haven't joined. The gym picks the event, never the words.
      const name = eventName || tPush(lang, 'event.announced.fallbackName');
      const prize = String(payload.prize ?? '').trim();
      const starts = new Date(String(payload.starts_at ?? '')).getTime();
      const when = Number.isFinite(starts) && starts > now
        ? tPush(lang, 'event.announced.starts', { day: ukDay(payload.starts_at, lang) })
        : tPush(lang, 'event.announced.onNow');
      const counts = `${countsLine(payload, gym, lang)}.`;
      const named = gym && !name.toLowerCase().includes(gym.toLowerCase());
      return {
        title: named ? tPush(lang, 'event.announced.titleAt', { gym, name }) : tPush(lang, 'event.announced.title', { name }),
        body: [
          when,
          counts,
          ...(prize ? [tPush(lang, 'event.announced.prize', { prize })] : []),
          tPush(lang, 'event.announced.tapToJoin'),
        ].join(' '),
      };
    }
    case 'event_kickoff': {
      // Registrants, the morning scoring starts. ends_at is a midnight
      // boundary (half-open), so the last day that counts is the one before
      // it: minus one minute.
      const name = eventName || tPush(lang, 'common.theEvent');
      const ends = new Date(String(payload.ends_at ?? '')).getTime();
      const lastDay = Number.isFinite(ends) ? ukDay(new Date(ends - 60_000).toISOString(), lang) : '';
      const counts = countsLine(payload, gym, lang);
      return {
        title: tPush(lang, 'event.kickoff.title', { name }),
        body: lastDay
          ? tPush(lang, 'event.kickoff.bodyUntil', { counts, day: lastDay })
          : tPush(lang, 'event.kickoff.body', { counts }),
      };
    }
    case 'gym_quiet_nudge': {
      // Someone drifting from a gym (well past their own usual gap between
      // visits), on the gym's press from Retention (gym_nudge_quiet). POWR's
      // words, never the gym's. `weeks` is since their last visit there.
      const weeks = Math.max(0, Math.round(Number(payload.weeks ?? 0)));
      const since = weeks >= 2
        ? tPush(lang, 'event.quietNudge.sinceWeeks', { weeks: `${weeks}` })
        : tPush(lang, 'event.quietNudge.sinceAWhile');
      return {
        title: gym ? tPush(lang, 'event.quietNudge.titleGym', { gym }) : tPush(lang, 'event.quietNudge.title'),
        body: tPush(lang, 'event.quietNudge.body', { since }),
      };
    }
    case 'gym_on_powr': {
      // Once per gym, automatically, when its portal is first switched on
      // (_gym_member_notice_dispatch): the people the gym can now see in
      // Retention. It is also the notice the privacy policy promises, so it
      // says what the gym sees and where the switch is ("Let gyms see my
      // visits", Settings, then Privacy).
      return {
        title: gym ? tPush(lang, 'event.onPowr.titleGym', { gym }) : tPush(lang, 'event.onPowr.title'),
        body: tPush(lang, 'event.onPowr.body'),
      };
    }
    case 'event_doors_open': {
      // Registrants, the morning of the finale night. The attendance reward
      // is paid to members the venue geofence sees during the night, so
      // "check in" is the ask.
      const name = eventName || tPush(lang, 'common.theEvent');
      const time = ukTime(payload.doors_open_at, lang);
      const bonus = Math.max(0, Math.round(Number(payload.attendance ?? 0)));
      const doors = time
        ? (gym ? tPush(lang, 'event.doorsOpen.timeAtGym', { time, gym }) : tPush(lang, 'event.doorsOpen.time', { time }))
        : (gym ? tPush(lang, 'event.doorsOpen.tonightAtGym', { gym }) : tPush(lang, 'event.doorsOpen.tonight'));
      return {
        title: tPush(lang, 'event.doorsOpen.title', { name }),
        body: bonus > 0 ? `${doors} ${tPush(lang, 'event.doorsOpen.bonus', { bonus: `${bonus}` })}` : doors,
      };
    }
  }
}
