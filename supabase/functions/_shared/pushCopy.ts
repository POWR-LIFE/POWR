// The words of every templated push send-push-notification sends, per type and
// per language. Moved out of send-push-notification/index.ts so it is pure
// (no Deno, no I/O) and Jest can import it: the function decides WHETHER and
// to WHOM, this module decides WHAT it says.
//
//   buildMessage(type, payload, lang)  // lang from languagesFor(); 'en' default
//
// English is the source and must not change by a byte when this file does:
// every English string lives in _shared/i18n/push/en.ts exactly as it used to
// be written inline here. Numbers keep the formatting they always had in
// English (a bare toLocaleString(), or none at all); other languages format
// with their own locale. Database content (reward, event, gym names, admin
// notes) goes in as a {{placeholder}}, never translated. Challenge names are
// the exception: a weekly challenge (by its catalog id) or a Together template
// (by its stored English title) we have a name for is quoted in the reader's
// language (challengeNames.*); any other name goes out as sent.
//
// Routing data (`data`) is identical in every language: it is read by the app,
// not by people.

import { eventPushCopy, ukDay } from './eventPushCopy.ts';
import { formatLocale, levelName, PUSH_CATALOGS, templateTitleKey, tPush, weeklyChallengeKey } from './i18n/index.ts';
import { levelDef } from './levels.ts';

export type NotificationType =
  | 'daily_reminder'
  | 'streak_at_risk'
  | 'weekly_challenge_expiry'
  | 'challenge_within_reach'
  | 'reward_unlocked'
  | 'check_in_reminder'
  | 'points_milestone'
  | 'inactivity_nudge'
  | 'sleep_target_met'
  | 'session_completed'
  | 'session_upgraded'
  | 'wearable_session_recorded'
  | 'level_up'
  | 'streak_lost'
  | 'streak_rescued'
  | 'vault_unlocked'
  | 'vault_ready'
  | 'vault_granted'
  | 'vault_banked'
  | 'creator_invite_eligible'
  | 'creator_invite_approved'
  | 'affiliate_milestone'
  | 'affiliate_conversion'
  | 'event_results_revealed'
  // Per-event pulse pushes scheduled from /admin/events (live_event_send_pulse):
  // your rank today / how many signups you still owe the entry gate.
  | 'event_rank_daily'
  | 'event_gate_reminder'
  // One-off event pushes (live_event_send_template), switched on per event by
  // the gym portal or /admin/events: the announcement to the venue's people,
  // the kickoff and the finale-night morning to registrants.
  | 'event_announced'
  | 'event_kickoff'
  | 'event_doors_open'
  // A gym's "your spot's still here" to members who share activity with it
  // and have gone quiet (gym_nudge_quiet, Clash Pro, on the gym's press).
  | 'gym_quiet_nudge'
  // Once per gym, automatically, the first time its portal is switched on:
  // "<gym> is on POWR" to the people it can now see (_gym_member_notice_dispatch).
  | 'gym_on_powr'
  // One-shot setup notice when a user loses 'always' location (dispatch-daily-
  // nudges Phase 3 — see _shared/locationRegression.ts for the eligibility rule).
  | 'location_permission_lost'
  // Shared ("together") challenges + friend graph (scope §4/§6a).
  | 'friend_request'
  | 'friend_accepted'
  | 'challenge_invite'
  | 'challenge_accepted'
  | 'challenge_started'
  | 'challenge_friend_finished'
  | 'challenge_pool_milestone'
  | 'challenge_completed'
  | 'challenge_expiring'
  | 'challenge_ended'
  | 'challenge_open_unclaimed'
  | 'challenge_open_posted'
  // The Autumn Series (series_dispatch_pushes, every 15 min): the 08:00 push
  // about your rival, and "<name> just passed you". Both open League on the
  // next-move line (focus=rival).
  | 'series_rival'
  | 'series_passed'
  // A round's moment starting (Double Down, Power Hour, Blind Mode …), set in
  // /admin/series: its name and line as written there.
  | 'series_moment';

/** One push, ready for deliverVisiblePush (which adds the per-device `to`). */
export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number; // seconds — Expo maps to apns-expiration / FCM ttl
}

// Time-to-live (seconds) for types that become noise if delivered late. Expo
// hands this to APNs (apns-expiration) / FCM (ttl), so the platform drops an
// still-undelivered push past the window instead of buzzing hours later — a
// "You're in. Every minute counts." that lands after the user has gone home is
// worse than nothing. Durable, still-relevant types (session_completed,
// reward_unlocked, points_milestone, and the social/challenge set) omit it so
// they always arrive, however delayed.
export const TTL_SECONDS: Partial<Record<NotificationType, number>> = {
  check_in_reminder:       15 * 60,      // only useful while still in the gym
  streak_at_risk:          6 * 60 * 60,  // must land before midnight
  weekly_challenge_expiry: 12 * 60 * 60,
  challenge_within_reach:  6 * 60 * 60,  // "you're close tonight" is stale by morning
  daily_reminder:          6 * 60 * 60,
  inactivity_nudge:        12 * 60 * 60,
  gym_quiet_nudge:         24 * 60 * 60,  // a day late is still a nudge; a week late is noise
  gym_on_powr:             48 * 60 * 60,  // a notice, not a moment: two days late still says it
  // Someone has probably taken it by tomorrow; a stale "new on the board" is
  // worse than none, because tapping it lands on a challenge that's gone.
  challenge_open_posted:   12 * 60 * 60,
  // "You're #4 today" delivered tomorrow is a wrong number, not a late one.
  event_rank_daily:        6 * 60 * 60,
  event_gate_reminder:     12 * 60 * 60,
  event_announced:         24 * 60 * 60,
  event_kickoff:           12 * 60 * 60,
  event_doors_open:        8 * 60 * 60,   // sent 09:00 for an evening night
  // A gap from this morning is wrong by tonight; a pass from an hour ago may
  // already be undone.
  series_rival:            6 * 60 * 60,
  series_passed:           3 * 60 * 60,
  // A Power Hour is over in an hour; nothing a moment says is news after two.
  series_moment:           2 * 60 * 60,
};

/** The one session that closes a Series gap, as the app says it (SeriesHome). */
function seriesHow(lang: string, gap: number, kind: 'rival' | 'passed'): string {
  const key = kind === 'rival' ? 'seriesRival' : 'seriesPassed';
  if (gap <= 10) return tPush(lang, `${key}.howRun`);
  if (gap <= 20) return tPush(lang, `${key}.howGym`);
  return tPush(lang, `${key}.howMany`, { n: `${Math.ceil(gap / 15)}` });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** A number that English printed with a bare toLocaleString(). */
function grouped(lang: string, value: any): string {
  return lang === 'en' ? value.toLocaleString() : value.toLocaleString(formatLocale(lang));
}

/** A number that English printed as-is (`${n}`). */
function plain(lang: string, value: any): string {
  return lang === 'en' || typeof value !== 'number' ? `${value}` : value.toLocaleString(formatLocale(lang));
}

/**
 * The `count` that picks a plural form. English keeps the exact test its copy
 * always used (`englishOne`, e.g. `points === 1`) so an odd payload can't flip
 * an English word; other languages get their own plural rules on the number.
 * The number itself is always shown through its own placeholder, never
 * {{count}}, so formatting stays per language.
 */
function pluralCount(lang: string, value: unknown, englishOne: boolean): number {
  if (lang === 'en') return englishOne ? 1 : 2;
  const n = Number(value);
  return Number.isFinite(n) ? n : 2;
}

/** A challenge or reward name in the language's quotation marks. */
export function quotedTitle(lang: string, title: unknown): string {
  return tPush(lang, 'common.quoted', { title: `${title}` });
}

/**
 * The quoted name as every push language writes it. dispatch-daily-nudges
 * dedupes the weekly "within reach" nudge on push_send_log.body containing the
 * quoted challenge name, so this must cover every language a body can be in —
 * and every name it can be in: a weekly challenge's own English name is quoted
 * translated (weeklyChallengeName), so each weekly challenge called `title`
 * adds its name in every language. Two challenges can share an English name
 * ("Twice This Week" runs and rides); both count, as they always did.
 */
export function quotedTitleMarkers(title: string): string[] {
  // No title, no way to dedupe: throw, as the LIKE pattern this replaced did,
  // so the dispatcher counts the target as failed rather than nudging blind.
  if (typeof title !== 'string') throw new TypeError('quotedTitleMarkers: title must be a string');
  const weekly = catalogBranch(PUSH_CATALOGS.en, 'challengeNames', 'weekly');
  const ids = Object.keys(weekly).filter((id) => weekly[id] === title);
  const markers = new Set<string>();
  for (const lang of Object.keys(PUSH_CATALOGS)) {
    markers.add(quotedTitle(lang, title));
    for (const id of ids) markers.add(quotedTitle(lang, tPush(lang, `challengeNames.weekly.${id}`)));
  }
  return [...markers];
}

/** A nested branch of a catalog (string leaves only), or {} if it isn't there. */
function catalogBranch(catalog: unknown, ...path: string[]): Record<string, unknown> {
  let node: unknown = catalog;
  for (const part of path) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  return node && typeof node === 'object' ? (node as Record<string, unknown>) : {};
}

/**
 * A weekly challenge's name, for the weekly board's nudges. Senders put the
 * catalog id (`challenge_id`) and its English name (`challenge_name`) in the
 * payload. Other languages get the catalog's name for that id — but only while
 * the name sent is still the catalog's own: an admin catalog override can
 * rename a challenge, and that name goes out as written. English always shows
 * `challenge_name` as sent, as before.
 */
function weeklyChallengeName(lang: string, payload: Record<string, unknown>, fallbackKey: string): string {
  const sent = payload.challenge_name as string | undefined;
  const id = weeklyChallengeKey(payload.challenge_id);
  if (lang !== 'en' && id) {
    const key = `challengeNames.weekly.${id}`;
    const english = tPush('en', key);
    if (english !== key && (sent == null || sent === english)) return tPush(lang, key);
  }
  return sent ?? tPush(lang, fallbackKey);
}

// "on 16 Sep" for a vault maturity date. Falls back to a vaguer phrase rather
// than printing "Invalid Date" if the timestamp is missing or unparseable.
export function formatVestDate(vestsAt: unknown, lang = 'en'): string {
  const d = new Date(String(vestsAt ?? ''));
  if (Number.isNaN(d.getTime())) return tPush(lang, 'vault.unlocksLater');
  // Other languages spell the month out: "oct." would end the sentence twice.
  return tPush(lang, 'vault.unlocksOn', {
    date: d.toLocaleDateString(formatLocale(lang), {
      day: 'numeric', month: lang === 'en' ? 'short' : 'long', timeZone: 'Europe/London',
    }),
  });
}

export function formatSessionCompletedBody(
  partnerName?: string | null,
  currentStreak?: number | null,
  earned?: number | null,
  lang = 'en',
): string {
  const name = partnerName?.trim();
  const streak = Number(currentStreak ?? 0);
  const pts = Math.max(0, Math.round(Number(earned ?? 0)));

  // Fold the points earned into the body so the single "Session recorded"
  // notification carries everything — no separate "+X pts" push needed.
  const parts: string[] = [];
  if (name) parts.push(name);
  if (pts > 0) parts.push(tPush(lang, 'sessionCompleted.points', { points: grouped(lang, pts) }));
  if (streak > 0) parts.push(tPush(lang, 'sessionCompleted.streak', { streak: `${streak}` }));

  return parts.length > 0 ? parts.join(' · ') : tPush(lang, 'sessionCompleted.fallback');
}

// Several events can run at once, so an event push opens THAT event's board:
// the League tab reads ?event=<slug>. Payloads from before the DB started
// sending event_slug (20260924160100) keep the bare tab.
export function eventLeagueRoute(payload: Record<string, unknown>): string {
  const slug = String(payload.event_slug ?? '').trim();
  return slug ? `/(tabs)/league?event=${encodeURIComponent(slug)}` : '/(tabs)/league';
}

// The weekly-board progress readout ("3/4 runs"). dispatch-daily-nudges sends
// it as English text (progress_text) plus its parts (progress_unit/_value/
// _target); English quotes the text as it always has, other languages rebuild
// it from the parts. Without the parts (an older sender) the English text is
// the only thing there is, so it is used as-is.
function weeklyProgress(lang: string, payload: Record<string, unknown>): string {
  const english = ((payload.progress_text as string) ?? '').trim();
  if (lang === 'en' || !english) return english;
  const value = Number(payload.progress_value);
  const target = Number(payload.progress_target);
  if (!Number.isFinite(value) || !Number.isFinite(target)) return english;
  const vars = {
    count: target,
    progress: value.toLocaleString(formatLocale(lang)),
    target: target.toLocaleString(formatLocale(lang)),
  };
  switch (payload.progress_unit) {
    case 'steps': return tPush(lang, 'progress.steps', vars);
    case 'km': return tPush(lang, 'progress.km', vars);
    case 'days': return tPush(lang, 'progress.days', vars);
    case 'categories': return tPush(lang, 'progress.categories', vars);
    case 'check-ins': return tPush(lang, 'progress.checkIns', vars);
    case 'runs': return tPush(lang, 'progress.runs', vars);
    case 'rides': return tPush(lang, 'progress.rides', vars);
    case 'sessions': return tPush(lang, 'progress.sessions', vars);
    default: return english;
  }
}

// What's left in a pooled challenge ("1,200 steps"). `unit` is the pool rule's
// display unit (_shared/sharedChallenges.ts PoolRule.unit), a fixed set, so
// other languages translate it; anything unexpected is shown as sent.
function poolRemaining(lang: string, remaining: number, unit: string): string {
  if (lang === 'en') return `${remaining.toLocaleString()}${unit ? ` ${unit}` : ''}`.trim();
  const value = remaining.toLocaleString(formatLocale(lang));
  const vars = { count: remaining, value };
  switch (unit) {
    case 'steps': return tPush(lang, 'units.steps', vars);
    case 'km': return tPush(lang, 'units.km', vars);
    case 'mi': return tPush(lang, 'units.mi', vars);
    case 'check-ins': return tPush(lang, 'units.checkIns', vars);
    case 'runs': return tPush(lang, 'units.runs', vars);
    case 'rides': return tPush(lang, 'units.rides', vars);
    case 'sessions': return tPush(lang, 'units.sessions', vars);
    default: return `${value}${unit ? ` ${unit}` : ''}`.trim();
  }
}

// The streak-rescue requirement ("2 sessions", "15,000 steps"). The sweep
// sends it as English text (requirement_text) and, since this module learned
// to translate it, as parts too (requirement_type/_count). English always
// quotes the text; other languages rebuild it from the parts when they're there.
function rescueRequirement(lang: string, payload: Record<string, unknown>): string {
  const english = String(payload.requirement_text ?? '').trim();
  const count = Number(payload.requirement_count);
  if (lang !== 'en' && typeof payload.requirement_type === 'string' && Number.isFinite(count)) {
    const vars = { count, n: count.toLocaleString(formatLocale(lang)) };
    switch (payload.requirement_type) {
      case 'gym_sessions': return tPush(lang, 'streakLost.requirement.gymSessions', vars);
      case 'active_days': return tPush(lang, 'streakLost.requirement.activeDays', vars);
      case 'steps': return tPush(lang, 'streakLost.requirement.steps', vars);
      default: return tPush(lang, 'streakLost.requirement.sessions', vars);
    }
  }
  if (english) return english;
  const sessions = Math.max(1, Math.round(Number(payload.sessions_required ?? 2)));
  return tPush(lang, 'streakLost.sessionsFallback', { count: pluralCount(lang, sessions, false), sessions: `${sessions}` });
}

// A POWR activity type's name as the app shows it (activityNames.*, kept equal
// to the app's activities.json by a test), or undefined for anything else.
function activityName(lang: string, type: unknown): string | undefined {
  switch (type) {
    case 'walking': return tPush(lang, 'activityNames.walking');
    case 'running': return tPush(lang, 'activityNames.running');
    case 'cycling': return tPush(lang, 'activityNames.cycling');
    case 'swimming': return tPush(lang, 'activityNames.swimming');
    case 'gym': return tPush(lang, 'activityNames.gym');
    case 'hiit': return tPush(lang, 'activityNames.hiit');
    case 'sports': return tPush(lang, 'activityNames.sports');
    case 'yoga': return tPush(lang, 'activityNames.yoga');
    case 'dance': return tPush(lang, 'activityNames.dance');
    case 'sleep': return tPush(lang, 'activityNames.sleep');
    default: return undefined;
  }
}

// The vault_banked body for languages other than English. claim-points and
// upgrade-gym-tier send `reason` as English text ("3-day streak bonus", "gym
// session", "40-min bonus") and, beside it, what it was made of: reason_kind
// plus streak_days / activity_type / upgrade_minutes. English never calls
// this (it always quotes `reason`); undefined means "no usable parts, quote
// `reason` as sent", which is what an older caller gets.
function vaultBankedBody(
  lang: string,
  payload: Record<string, unknown>,
  points: string,
  when: string,
): string | undefined {
  switch (payload.reason_kind) {
    case 'streak': {
      const days = Number(payload.streak_days);
      if (!Number.isFinite(days) || days <= 0) return undefined;
      return tPush(lang, 'vaultBanked.bodyStreak', { count: days, days: plain(lang, days), points, when });
    }
    case 'session': {
      const activity = activityName(lang, payload.activity_type);
      return activity ? tPush(lang, 'vaultBanked.bodySession', { activity, points, when }) : undefined;
    }
    case 'upgrade': {
      const minutes = Number(payload.upgrade_minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
      return tPush(lang, 'vaultBanked.bodyUpgrade', { minutes: plain(lang, minutes), points, when });
    }
    default:
      return undefined;
  }
}

/**
 * A challenge title or a person's name from the payload, as this language
 * should see it. A shared-challenge or friend sender with no title or name
 * still fills `title` / `from_name` with English ('your challenge', 'A
 * friend', 'Someone'), which English shows as sent, and flags it with
 * `title_missing` / `from_name_missing`. Other languages then treat the field
 * as absent and use their own fallback rather than an English phrase.
 */
function sentText(lang: string, payload: Record<string, unknown>, field: 'title' | 'from_name'): unknown {
  return lang !== 'en' && payload[`${field}_missing`] === true ? undefined : payload[field];
}

/**
 * A Together challenge's title, as this language should see it: the stored
 * English title of a template we have a name for (_shared/i18n/challengeNames)
 * comes out in the reader's language; any other title as sent. English is
 * always as sent.
 */
function challengeTitle(lang: string, payload: Record<string, unknown>): unknown {
  const sent = sentText(lang, payload, 'title');
  if (lang === 'en') return sent;
  const key = templateTitleKey(sent);
  return key ? tPush(lang, `challengeNames.templates.${key}`) : sent;
}

// ---------------------------------------------------------------------------
// Notification copy per type
// ---------------------------------------------------------------------------

export function buildMessage(
  type: NotificationType,
  payload: Record<string, unknown>,
  lang = 'en',
): PushMessage {
  const safePoints = (() => {
    const points = Number(payload.points ?? 0);
    return Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;
  })();
  const base = ((): PushMessage | undefined => {
    switch (type) {
      case 'daily_reminder':
        return {
          title: tPush(lang, 'dailyReminder.title'),
          body: tPush(lang, 'dailyReminder.body'),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };

      case 'streak_at_risk': {
        const streak = (payload.current_streak as number) ?? 0;
        return {
          title: tPush(lang, 'streakAtRisk.title', { count: pluralCount(lang, streak, false), days: `${streak}` }),
          body: tPush(lang, 'streakAtRisk.body'),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_streak_v2',
          priority: 'high',
        };
      }

      case 'weekly_challenge_expiry': {
        const name = weeklyChallengeName(lang, payload, 'weeklyChallengeExpiry.fallbackName');
        const progress = weeklyProgress(lang, payload);
        const quoted = quotedTitle(lang, name);
        return {
          title: tPush(lang, 'weeklyChallengeExpiry.title'),
          // With a progress payload (the board nudge) the message is specific;
          // without one (legacy senders) fall back to the generic line.
          body: progress
            ? (safePoints > 0
                ? tPush(lang, 'weeklyChallengeExpiry.bodyProgressPoints', { quoted, progress, points: plain(lang, safePoints) })
                : tPush(lang, 'weeklyChallengeExpiry.bodyProgress', { quoted, progress }))
            : tPush(lang, 'weeklyChallengeExpiry.body', { quoted }),
          data: { type, route: '/(tabs)/index' }, // the weekly board lives on Home
          sound: 'default',
          channelId: 'powr_streak_v2',
        };
      }

      case 'challenge_within_reach': {
        const name = weeklyChallengeName(lang, payload, 'challengeWithinReach.fallbackName');
        const progress = weeklyProgress(lang, payload);
        // ⚠ Every body below carries quotedTitle(): dispatch-daily-nudges
        // dedupes this nudge on it (once per challenge per week).
        const quoted = quotedTitle(lang, name);
        const points = plain(lang, safePoints);
        return {
          title: tPush(lang, 'challengeWithinReach.title'),
          body: progress
            ? (safePoints > 0
                ? tPush(lang, 'challengeWithinReach.bodyPoints', { quoted, progress, points })
                : tPush(lang, 'challengeWithinReach.body', { quoted, progress }))
            : (safePoints > 0
                ? tPush(lang, 'challengeWithinReach.bodyNearlyPoints', { quoted, points })
                : tPush(lang, 'challengeWithinReach.bodyNearly', { quoted })),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'normal',
        };
      }

      case 'reward_unlocked': {
        // Fired by the notify_reward_unlocks ledger trigger. count > 1 with no
        // named reward = several crossed at once — lead with the count and let
        // the wallet do the reveal; naming one of several undersells the rest.
        const count = Math.max(1, Math.round(Number(payload.count ?? 1)));
        const rewardName = ((payload.reward_name as string) ?? '').trim();
        const multi = count > 1 && !rewardName;
        const many = { count: pluralCount(lang, count, false), number: `${count}` };
        return {
          title: multi ? tPush(lang, 'rewardUnlocked.titleMany', many) : tPush(lang, 'rewardUnlocked.title'),
          body: multi
            ? tPush(lang, 'rewardUnlocked.bodyMany', many)
            : rewardName
              ? tPush(lang, 'rewardUnlocked.body', { quoted: quotedTitle(lang, rewardName) })
              : tPush(lang, 'rewardUnlocked.bodyNoName'),
          data: { type, route: '/(tabs)/rewards', reward_id: payload.reward_id, count },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'check_in_reminder': {
        return {
          title: 'POWR',
          body: tPush(lang, 'checkInReminder.body'),
          data: { type, route: '/(tabs)/index', location_id: payload.location_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'location_permission_lost': {
        // Tone: their check-ins stopped, not "you broke something" — some
        // regressions are deliberate opt-outs, and the push must read fine for
        // those too. Routes Home, where SetupHealthBanner / LocationPrimeSheet
        // own the actual fix flow. No TTL: still true whenever it lands.
        // `gym_relevant` comes from dispatch-daily-nudges via
        // _shared/activityRelevance.ts (declared picks ∪ last-21-day sessions).
        // A walk/run-only user gets the venue-neutral wording; absent = legacy
        // caller = assume gym, as before.
        const level = String(payload.level ?? 'denied');
        const gymRelevant = payload.gym_relevant !== false;
        return {
          title: gymRelevant ? tPush(lang, 'locationPermissionLost.titleGym') : tPush(lang, 'locationPermissionLost.titleVenue'),
          body: level === 'while_using'
            ? tPush(lang, 'locationPermissionLost.bodyWhileUsing')
            : gymRelevant
              ? tPush(lang, 'locationPermissionLost.bodyGym')
              : tPush(lang, 'locationPermissionLost.bodyVenue'),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'points_milestone': {
        const points = (payload.points as number) ?? 0;
        const rawPointsToUnlock =
          (payload.points_to_unlock as number | undefined) ??
          (payload.pointsToUnlock as number | undefined);
        const pointsToUnlock = Math.max(0, Math.ceil(rawPointsToUnlock ?? 0));
        const rewardName =
          ((payload.reward_name as string | undefined) ??
            (payload.rewardName as string | undefined) ??
            '')
            .trim();
        const hasWithinReach = pointsToUnlock > 0;

        return {
          title: hasWithinReach
            ? tPush(lang, 'pointsMilestone.titleReach')
            : tPush(lang, 'pointsMilestone.title', { count: pluralCount(lang, points, false), points: grouped(lang, points) }),
          body: hasWithinReach
            ? (rewardName
                ? tPush(lang, 'pointsMilestone.bodyReach', { points: grouped(lang, pointsToUnlock), reward: rewardName })
                : tPush(lang, 'pointsMilestone.bodyReachNext', { points: grouped(lang, pointsToUnlock) }))
            : tPush(lang, 'pointsMilestone.body'),
          data: {
            type,
            route: '/(tabs)/rewards',
            points,
            points_to_unlock: hasWithinReach ? pointsToUnlock : undefined,
            reward_name: rewardName || undefined,
          },
          sound: 'default',
          channelId: 'powr_rewards_v2',
        };
      }

      case 'inactivity_nudge': {
        const days = (payload.days_inactive as number) ?? 3;
        const titles: Record<number, string> = {
          3: tPush(lang, 'inactivityNudge.day3.title'),
          7: tPush(lang, 'inactivityNudge.day7.title'),
        };
        const bodies: Record<number, string> = {
          3: tPush(lang, 'inactivityNudge.day3.body'),
          7: tPush(lang, 'inactivityNudge.day7.body'),
        };
        return {
          title: titles[days] ?? tPush(lang, 'inactivityNudge.fallback.title'),
          body: bodies[days] ?? tPush(lang, 'inactivityNudge.fallback.body'),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'sleep_target_met': {
        const hours = (payload.hours as number) ?? 0;
        const points = (payload.points as number) ?? 0;
        return {
          title: tPush(lang, 'sleepTargetMet.title'),
          body: tPush(lang, 'sleepTargetMet.body', {
            count: pluralCount(lang, points, points === 1),
            hours: lang === 'en' || typeof hours !== 'number'
              ? hours.toFixed(1)
              : hours.toLocaleString(formatLocale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            points: plain(lang, points),
          }),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'session_completed': {
        const sessionId = (payload.session_id as string) ?? '';
        const earned = Math.max(0, Math.round(Number(payload.earned ?? payload.points ?? 0)));
        const partnerName = payload.partner_name as string | undefined;
        const currentStreak = payload.current_streak as number | undefined;

        return {
          title: earned > 0 ? tPush(lang, 'sessionCompleted.titleEarned') : tPush(lang, 'sessionCompleted.title'),
          body: formatSessionCompletedBody(partnerName, currentStreak, earned, lang),
          data: {
            type,
            route: `/share-stats?mode=check-in&sessionId=${sessionId}`,
            session_id: sessionId,
            earned: earned > 0 ? earned : undefined,
            partner_name: partnerName,
            current_streak: currentStreak,
          },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'session_upgraded': {
        // The upgrade-tier bonus, credited by upgrade-gym-tier AFTER the initial
        // claim already pushed "Session recorded". `earned` is the delta (the
        // extra points for staying to the upgrade tier), carried explicitly
        // because the session now has multiple 'earn' rows on the ledger.
        // `upgrade_minutes` carries the admin-tunable threshold (default 40).
        const sessionId = (payload.session_id as string) ?? '';
        const earned = Math.max(0, Math.round(Number(payload.earned ?? 0)));
        const partnerName = (payload.partner_name as string | undefined)?.trim();
        const upgradeMins = Math.round(Number(payload.upgrade_minutes ?? 40)) || 40;

        const parts: string[] = [];
        if (partnerName) parts.push(partnerName);
        if (earned > 0) parts.push(tPush(lang, 'sessionUpgraded.points', { points: grouped(lang, earned) }));
        parts.push(tPush(lang, 'sessionUpgraded.bonus', { minutes: `${upgradeMins}` }));

        return {
          title: tPush(lang, 'sessionUpgraded.title'),
          body: parts.join(' · '),
          data: {
            type,
            route: `/share-stats?mode=check-in&sessionId=${sessionId}`,
            session_id: sessionId,
            earned: earned > 0 ? earned : undefined,
            partner_name: partnerName,
          },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'wearable_session_recorded': {
        // Terra workout(s) landed server-side and earned points — the receipt
        // the wearable-only crowd never had. One webhook batch = one push
        // (count carries how many); the notification_config daily_cap (1)
        // keeps later same-day syncs silent so backfills can't machine-gun.
        // activity_label is Terra's own name for the workout ("Spin") or the
        // POWR type, in English: English shows it as sent. Other languages
        // name the activity themselves (the app's own name for it) when the
        // caller says which it was (activity_type, terra-webhook) or the label
        // is itself a bare POWR type ("running", what both senders fall back
        // to when there's no name); otherwise the label as sent.
        const count = Math.max(1, Math.round(Number(payload.count ?? 1)));
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const label = ((payload.activity_label as string) ?? '').trim();
        const activity = lang === 'en'
          ? undefined
          : activityName(lang, payload.activity_type) ?? activityName(lang, label);
        const what = count > 1
          ? tPush(lang, 'wearableSessionRecorded.syncedMany', { count: pluralCount(lang, count, false), number: `${count}` })
          : activity
            ? tPush(lang, 'wearableSessionRecorded.syncedActivity', { activity })
            : label
              ? tPush(lang, 'wearableSessionRecorded.syncedLabel', { label })
              : tPush(lang, 'wearableSessionRecorded.synced');
        return {
          title: tPush(lang, 'wearableSessionRecorded.title'),
          body: points > 0
            ? tPush(lang, 'wearableSessionRecorded.bodyPoints', { count: pluralCount(lang, points, false), what, points: grouped(lang, points) })
            : tPush(lang, 'wearableSessionRecorded.body', { what }),
          data: { type, route: '/(tabs)/progress', count, points },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'creator_invite_eligible': {
        // Fired by trg_notify_creator_invite_eligible the moment a member's
        // converted referrals cross the creator-invite threshold. One-shot by
        // construction (exactly-equals in the trigger) plus daily_cap 1.
        const converted = Math.max(0, Math.round(Number(payload.converted ?? 0)));
        return {
          title: tPush(lang, 'creatorInviteEligible.title'),
          body: tPush(lang, 'creatorInviteEligible.body', { count: pluralCount(lang, converted, false), number: `${converted}` }),
          data: { type, route: '/(tabs)/index', converted },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }
      case 'creator_invite_approved': {
        // An admin approved their request — the creators row and portal link
        // exist by the time this fires (approval order in CreatorRequests.jsx).
        return {
          title: tPush(lang, 'creatorInviteApproved.title'),
          body: tPush(lang, 'creatorInviteApproved.body'),
          data: { type, route: '/affiliate' },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }
      case 'affiliate_milestone': {
        // trg_notify_affiliate_milestone — once per rung reached. Names the
        // reward; asks for an address only when a parcel is owed and none is on file.
        // `label` in data stays as it always was ('a step' when missing):
        // data is for the app, the title is for the person.
        const label = String(payload.label ?? 'a step').trim();
        const reward = String(payload.reward_name ?? '').trim();
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const ships = payload.ships === true;
        const needsAddress = payload.needs_address === true;
        let body: string;
        if (ships && reward) {
          body = needsAddress
            ? tPush(lang, 'affiliateMilestone.shipsAddress', { reward })
            : tPush(lang, 'affiliateMilestone.shipsInTouch', { reward });
          if (points > 0) body += ` ${tPush(lang, 'affiliateMilestone.bankedToo', { points: grouped(lang, points) })}`;
        } else {
          body = points > 0
            ? tPush(lang, 'affiliateMilestone.banked', { points: grouped(lang, points) })
            : tPush(lang, 'affiliateMilestone.reached');
        }
        const shownLabel = payload.label == null
          ? String(tPush(lang, 'affiliateMilestone.fallbackLabel')).trim()
          : label;
        return {
          title: tPush(lang, 'affiliateMilestone.title', { label: shownLabel }),
          body,
          data: { type, route: '/affiliate', label, reward_name: reward || undefined, points },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }
      case 'event_results_revealed': {
        // trg_notify_live_event_revealed — the admin pressed Reveal. Personal
        // where the frozen results allow it (your final rank, your prize); a
        // registrant outside the snapshot just gets the door to the board.
        const fallbackName = tPush(lang, 'common.theEvent');
        const eventName = String(payload.event_name ?? fallbackName).trim() || fallbackName;
        const rank = Math.round(Number(payload.rank));
        const prize = String(payload.prize_label ?? '').trim();
        // The gym's optional partner code went out just before this push
        // (_live_event_issue_partner_codes): it's already in their Wallet, so
        // say whose it is.
        const partnerBrand = String(payload.partner_brand ?? '').trim();
        const partnerLine = partnerBrand ? tPush(lang, 'eventResultsRevealed.partnerCode', { brand: partnerBrand }) : '';
        const body = Number.isFinite(rank) && rank > 0
          ? [
              prize
                ? tPush(lang, 'eventResultsRevealed.rankPrize', { rank: `${rank}`, prize })
                : tPush(lang, 'eventResultsRevealed.rank', { rank: `${rank}` }),
              partnerLine,
              tPush(lang, 'eventResultsRevealed.seeBoard'),
            ].filter(Boolean).join(' ')
          : [tPush(lang, 'eventResultsRevealed.noRank'), partnerLine].filter(Boolean).join(' ');
        return {
          title: tPush(lang, 'eventResultsRevealed.title', { event: eventName }),
          body,
          data: {
            type,
            route: eventLeagueRoute(payload),
            event_id: payload.event_id,
            rank: Number.isFinite(rank) && rank > 0 ? rank : undefined,
          },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'series_rival': {
        // series_dispatch_pushes, 08:00 in the member's own timezone. The rival
        // is the same person League's next-move line names (get_series_board).
        const name = String(payload.name ?? '').trim() || tPush(lang, 'seriesRival.someone');
        const gap = Math.max(1, Math.round(Number(payload.gap ?? 0)));
        const pts = grouped(lang, gap);
        // The season's name ("Winter Series"), from the round's season.
        const series = String(payload.series ?? '').trim() || tPush(lang, 'seriesRival.series');
        return {
          title: tPush(lang, 'seriesRival.title'),
          body: payload.ahead === true
            ? tPush(lang, 'seriesRival.bodyLead', { name, gap: pts, series })
            : tPush(lang, 'seriesRival.bodyChase', { name, gap: pts, series, how: seriesHow(lang, gap, 'rival') }),
          data: { type, route: '/(tabs)/league?focus=rival' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'series_passed': {
        // series_dispatch_pushes: the closest person above you who was behind
        // you at the last check. Capped once a day in notification_config.
        const name = String(payload.name ?? '').trim() || tPush(lang, 'seriesRival.someone');
        const gap = Math.max(1, Math.round(Number(payload.gap ?? 0)));
        const rank = Math.round(Number(payload.rank));
        const series = String(payload.series ?? '').trim() || tPush(lang, 'seriesRival.series');
        return {
          title: tPush(lang, 'seriesPassed.title', { name }),
          body: tPush(lang, 'seriesPassed.body', {
            series,
            rank: Number.isFinite(rank) && rank > 0 ? `${rank}` : '?',
            gap: grouped(lang, gap),
            how: seriesHow(lang, gap, 'passed'),
          }),
          data: { type, route: '/(tabs)/league?focus=rival' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'series_moment': {
        // series_dispatch_pushes, once, when a moment starts. The name and line
        // are the admin's words for this moment; the line falls back to "It's on
        // now in the <season>" when it's left empty.
        const series = String(payload.series ?? '').trim() || tPush(lang, 'seriesRival.series');
        const title = String(payload.title ?? '').trim() || tPush(lang, 'seriesMoment.title');
        const body = String(payload.body ?? '').trim() || tPush(lang, 'seriesMoment.body', { series });
        return {
          title,
          body,
          data: { type, route: '/(tabs)/league' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'event_rank_daily': {
        // live_event_send_pulse 'rank' — the daily "where you stand" pulse the
        // admin schedules per event. rank_delta shares the board arrows'
        // reference (since the scoring day began), so push and app agree.
        const fallbackName = tPush(lang, 'common.theEvent');
        const eventName = String(payload.event_name ?? fallbackName).trim() || fallbackName;
        const rank = Math.round(Number(payload.rank));
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const delta = Math.round(Number(payload.rank_delta));
        const gap = Math.round(Number(payload.gap_above));
        const lead = Math.round(Number(payload.lead));
        const hasRank = Number.isFinite(rank) && rank > 0;
        let body: string;
        if (hasRank) {
          const pts = grouped(lang, points);
          const standing = Number.isFinite(delta) && delta > 0
            ? tPush(lang, 'eventRankDaily.pointsUp', { count: pluralCount(lang, delta, false), points: pts, places: `${delta}` })
            : Number.isFinite(delta) && delta < 0
              ? tPush(lang, 'eventRankDaily.pointsDown', { count: pluralCount(lang, -delta, false), points: pts, places: `${-delta}` })
              : tPush(lang, 'eventRankDaily.points', { points: pts });
          const chase = rank === 1
            ? (Number.isFinite(lead) && lead > 0
                ? tPush(lang, 'eventRankDaily.leadClear', { lead: grouped(lang, lead) })
                : tPush(lang, 'eventRankDaily.keepIt'))
            : (Number.isFinite(gap) && gap > 0
                ? tPush(lang, 'eventRankDaily.behind', { gap: grouped(lang, gap), above: `${rank - 1}` })
                : tPush(lang, 'eventRankDaily.todayCounts'));
          body = `${standing} ${chase}`;
        } else {
          body = tPush(lang, 'eventRankDaily.bodyNoRank');
        }
        return {
          title: hasRank
            ? (rank === 1
                ? tPush(lang, 'eventRankDaily.titleFirst', { event: eventName })
                : tPush(lang, 'eventRankDaily.titleRank', { event: eventName, rank: `${rank}` }))
            : tPush(lang, 'eventRankDaily.titleNoRank', { event: eventName }),
          body,
          data: {
            type,
            route: eventLeagueRoute(payload),
            event_id: payload.event_id,
            rank: hasRank ? rank : undefined,
          },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'event_gate_reminder': {
        // live_event_send_pulse 'gate' — only registrants still short of the
        // entry gate get this, only while the deadline is ahead.
        const fallbackName = tPush(lang, 'common.theEvent');
        const eventName = String(payload.event_name ?? fallbackName).trim() || fallbackName;
        const required = Math.max(1, Math.round(Number(payload.required ?? 1)));
        const count = Math.min(required - 1, Math.max(0, Math.round(Number(payload.count ?? 0))));
        const remaining = required - count;
        const conversions = payload.counting === 'conversions';
        // The gate deadline is a real instant (FNL: Fri 18:00), but when it
        // falls back to a midnight boundary the half-open rule applies — name
        // the last day that counts, never the boundary day. Minus one minute
        // does both: 18:00 stays its own day, 00:00 becomes the day before.
        const dl = new Date(String(payload.deadline_at ?? ''));
        const day = Number.isNaN(dl.getTime()) ? '' : lang === 'en'
          ? new Date(dl.getTime() - 60_000).toLocaleDateString(formatLocale(lang), {
              weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
            })
          : ukDay(new Date(dl.getTime() - 60_000).toISOString(), lang);
        const entry = payload.gate_mode === 'entry';
        const done = { count: pluralCount(lang, count, false), done: `${count}`, required: `${required}` };
        const progress = conversions
          ? tPush(lang, 'eventGateReminder.progressConversions', done)
          : tPush(lang, 'eventGateReminder.progressSignups', done);
        const hit = entry
          ? (day
              ? tPush(lang, 'eventGateReminder.unlockBy', { required: `${required}`, day })
              : tPush(lang, 'eventGateReminder.unlock', { required: `${required}` }))
          : (day
              ? tPush(lang, 'eventGateReminder.keepBy', { required: `${required}`, day })
              : tPush(lang, 'eventGateReminder.keep', { required: `${required}` }));
        const left = { count: pluralCount(lang, remaining, remaining === 1), event: eventName, remaining: `${remaining}` };
        return {
          title: conversions
            ? tPush(lang, 'eventGateReminder.titleConversions', left)
            : tPush(lang, 'eventGateReminder.titleSignups', left),
          body: `${progress} ${hit}`,
          data: { type, route: eventLeagueRoute(payload), event_id: payload.event_id, count, required },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'gym_quiet_nudge':
      case 'gym_on_powr': {
        // gym_nudge_quiet — the gym pressed Send on its Members page; or
        // gym_on_powr — the gym's portal went on (once, automatically). Tapping
        // opens the gym's card in Discover (a check-in is the ask), which
        // needs the venue id and where it is; the tab alone otherwise.
        const { title, body } = eventPushCopy(type, payload, undefined, lang);
        const venue = String(payload.partner_id ?? '').trim();
        const lat = Number(payload.lat);
        const lng = Number(payload.lng);
        const route = venue && Number.isFinite(lat) && Number.isFinite(lng)
          ? `/(tabs)/discover?venue=${encodeURIComponent(venue)}&lat=${lat}&lng=${lng}`
          : '/(tabs)/discover';
        return {
          title,
          body,
          data: { type, route, partner_id: venue },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'event_announced':
      case 'event_kickoff':
      case 'event_doors_open': {
        // live_event_send_template — the one-offs a gym switches on per event.
        // The words live in _shared/eventPushCopy.ts, which the gym portal's
        // preview renders too, so the preview can never drift from the push.
        const { title, body } = eventPushCopy(type, payload, undefined, lang);
        return {
          title,
          body,
          data: { type, route: eventLeagueRoute(payload), event_id: payload.event_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
      case 'affiliate_conversion': {
        // trg_notify_affiliate_conversion — daily_cap 1, so the one that
        // lands carries where they stand now.
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const remaining = payload.remaining == null ? null : Math.max(0, Math.round(Number(payload.remaining)));
        const nextName = String(payload.next_name ?? '').trim();
        const converted = points > 0
          ? tPush(lang, 'affiliateConversion.bodyPoints', { points: grouped(lang, points) })
          : tPush(lang, 'affiliateConversion.body');
        const tail = remaining != null && nextName
          ? tPush(lang, 'affiliateConversion.next', { count: pluralCount(lang, remaining, false), remaining: `${remaining}`, next: nextName })
          : '';
        return {
          title: tPush(lang, 'affiliateConversion.title'),
          body: tail ? `${converted} ${tail}` : converted,
          data: { type, route: '/affiliate', points, remaining, next_name: nextName || undefined },
          sound: 'default',
          channelId: 'powr_rewards_v2',
        };
      }
      case 'level_up': {
        // Fired by the vault_level_up_push ledger trigger — the same detection
        // that banks the level-up vault bonus, so it fires however the points
        // arrived (geofence, wearable, bonus) and even with the app closed.
        const level = Math.max(1, Math.round(Number(payload.level ?? 1)));
        const def = levelDef(level);
        const name = (lang === 'en' ? (def?.name ?? '') : def ? levelName(lang, level) : '').trim();
        return {
          title: tPush(lang, 'levelUp.title', { level: `${level}` }),
          body: name
            ? tPush(lang, 'levelUp.body', { name })
            : tPush(lang, 'levelUp.bodyNoName'),
          data: { type, route: '/(tabs)/index', level },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'streak_lost': {
        // The rescue offer, sent the morning after a streak dies — the single
        // highest-churn moment there is. POWR's version of streak repair is
        // earned with effort, not bought. requirement_text comes from the
        // admin-authored challenge template the sweep drew ("2 sessions",
        // "15,000 steps", "1 gym session"…).
        const lost = Math.max(1, Math.round(Number(payload.lost_streak ?? 0)));
        const hours = Math.max(1, Math.round(Number(payload.window_hours ?? 48)));
        const requirement = rescueRequirement(lang, payload);
        return {
          title: tPush(lang, 'streakLost.title', { count: pluralCount(lang, lost, false), days: `${lost}` }),
          body: tPush(lang, 'streakLost.body', { requirement, hours: `${hours}` }),
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_streak_v2',
          priority: 'high',
        };
      }

      case 'streak_rescued': {
        // current_streak is recomputed server-side (the bridge day is live by
        // the time this sends), so "Day N" is the restored truth.
        const streak = Math.max(0, Math.round(Number(payload.current_streak ?? 0)));
        return {
          title: tPush(lang, 'streakRescued.title'),
          body: streak > 0
            ? tPush(lang, 'streakRescued.body', { streak: `${streak}` })
            : tPush(lang, 'streakRescued.bodyNoDay'),
          data: { type, route: '/(tabs)/index', current_streak: streak || undefined },
          sound: 'default',
          channelId: 'powr_streak_v2',
          priority: 'high',
        };
      }

      case 'vault_unlocked': {
        // Fired by release-vault-deposits when matured deposits land on the
        // spendable balance. `points` is the total released this sweep.
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        return {
          title: tPush(lang, 'vaultUnlocked.title'),
          body: tPush(lang, 'vaultUnlocked.body', { points: grouped(lang, points) }),
          data: { type, route: '/vault', points },
          sound: 'default',
          channelId: 'powr_rewards_v2',
        };
      }

      case 'vault_ready': {
        // Fired down two paths, both landing on the same moment: an admin
        // unlock event pulling deposits forward, and the natural-maturity
        // sweep (notify_matured_vault_deposits) catching a vest window that
        // simply ran out. Either way the user still does the press-and-hold.
        // ⚠ "the dial", not "the door" — the door is a display, and the dial
        // beside it is the only control on that screen.
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        return {
          title: tPush(lang, 'vaultReady.title'),
          body: points > 0
            ? tPush(lang, 'vaultReady.body', { points: grouped(lang, points) })
            : tPush(lang, 'vaultReady.bodyNoPoints'),
          data: { type, route: '/vault', points },
          sound: 'default',
          channelId: 'powr_rewards_v2',
        };
      }

      case 'vault_banked': {
        // The deposit moment for cap overflow — the ONLY vault event the user
        // was never told about. Field 2026-08-08: a 40-minute gym upgrade was
        // banked at 09:25:05 and the run went completely silent, because
        // upgrade-gym-tier returns before its push whenever the whole delta is
        // vaulted (finalDelta 0). The tester did the same 40 minutes on two
        // phones, watched one say "Bonus unlocked" and the other say nothing,
        // and had no way to tell a capped award from a broken one.
        //
        // That account had 385 POWR across 22 deposits, none of them ever
        // announced. Silence is the one outcome this codebase treats as a bug
        // everywhere else — earning something and being told nothing reads as
        // "it didn't work", which is exactly what the beacon telemetry exists
        // to stop.
        //
        // Leads with the earn, not the cap: the user did the work and the
        // points are theirs. The cap is the reason it went to the Vault rather
        // than the balance, so it is explanation, not headline.
        //
        // `reason` arrives as English text from claim-points / upgrade-gym-tier
        // ("3-day streak bonus", "gym session", "40-min bonus"). English quotes
        // it as sent, always; other languages rebuild the sentence from the
        // parts sent beside it (vaultBankedBody) and quote `reason` only when
        // an older caller sent no parts.
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
        const pts = grouped(lang, points);
        const when = formatVestDate(payload.vests_at, lang);
        const translated = lang === 'en' ? undefined : vaultBankedBody(lang, payload, pts, when);
        return {
          title: tPush(lang, 'vaultBanked.title'),
          body: translated
            ?? (reason
              ? tPush(lang, 'vaultBanked.bodyReason', { points: pts, reason, when })
              : tPush(lang, 'vaultBanked.body', { points: pts, when })),
          data: { type, route: '/vault', points },
          sound: 'default',
          channelId: 'powr_rewards_v2',
        };
      }

      case 'vault_granted': {
        // Fired by notify-vault-grant when an admin banks POWR into a user's
        // Vault. Unlike vault_ready/vault_unlocked this is a gift landing, not
        // a maturity event — so it leads with the drop and only then says what
        // happens next. `note` is the admin's message when they left one,
        // shown as written in every language.
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const note = typeof payload.note === 'string' ? payload.note.trim() : '';
        const ready = payload.ready === true;

        // Deposits count toward level the moment they land (the level trigger
        // sums pending vault alongside the ledger) — worth saying, since the
        // spendable balance won't move until the door is opened.
        const detail = ready
          ? tPush(lang, 'vaultGranted.bodyReady', { points: grouped(lang, points) })
          : tPush(lang, 'vaultGranted.bodyBanked', { points: grouped(lang, points), when: formatVestDate(payload.vests_at, lang) });

        return {
          title: ready ? tPush(lang, 'vaultGranted.titleReady') : tPush(lang, 'vaultGranted.titleBanked'),
          body: `${note ? `${note} — ` : ''}${detail}`,
          data: { type, route: '/vault', points, ready },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      // ── Friend graph ──────────────────────────────────────────────────────
      case 'friend_request': {
        const name = (sentText(lang, payload, 'from_name') as string) || tPush(lang, 'common.someone');
        return {
          title: tPush(lang, 'friendRequest.title'),
          body: tPush(lang, 'friendRequest.body', { name }),
          data: { type, route: '/friends', from_user_id: payload.from_user_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'friend_accepted': {
        const name = (sentText(lang, payload, 'from_name') as string) || tPush(lang, 'common.yourFriend');
        return {
          title: tPush(lang, 'friendAccepted.title'),
          body: tPush(lang, 'friendAccepted.body', { name }),
          data: { type, route: '/friends', from_user_id: payload.from_user_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      // ── Shared challenges ─────────────────────────────────────────────────
      case 'challenge_invite': {
        const name = (sentText(lang, payload, 'from_name') as string) || tPush(lang, 'common.aFriend');
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.aChallenge');
        return {
          title: tPush(lang, 'challengeInvite.title', { name }),
          body: tPush(lang, 'challengeInvite.body', { quoted: quotedTitle(lang, title) }),
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'challenge_accepted': {
        const name = (sentText(lang, payload, 'from_name') as string) || tPush(lang, 'common.aFriend');
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallengeLower');
        const accepted = Math.max(0, Math.round(Number(payload.accepted_count ?? 0)));
        const total = Math.max(0, Math.round(Number(payload.total_count ?? 0)));
        const quoted = quotedTitle(lang, title);
        return {
          title: tPush(lang, 'challengeAccepted.title', { name }),
          body: accepted > 0 && total > 0
            ? tPush(lang, 'challengeAccepted.bodyCount', { name, quoted, accepted: `${accepted}`, total: `${total}` })
            : tPush(lang, 'challengeAccepted.body', { name, quoted }),
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_started': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallenge');
        // A shared challenge starts on the SECOND accept, not a full roster —
        // outstanding invitees keep their Accept card and join mid-race
        // (tryStartForming). The old copy said "everyone's in" regardless, so a
        // group of five that had one acceptance was told the whole group was in.
        // Counts absent (an older caller) falls back to the neutral line rather
        // than to the claim.
        const inCount = Math.max(0, Math.round(Number(payload.accepted_count ?? 0)));
        const rosterCount = Math.max(0, Math.round(Number(payload.total_count ?? 0)));
        const stillOut = Math.max(0, rosterCount - inCount);
        const quoted = quotedTitle(lang, title);
        const body =
          inCount > 0 && stillOut > 0
            ? tPush(lang, 'challengeStarted.bodyPartial', { quoted, joined: `${inCount}`, roster: `${rosterCount}` })
            : inCount > 0
              ? tPush(lang, 'challengeStarted.bodyAll', { quoted })
              : tPush(lang, 'challengeStarted.body', { quoted });
        return {
          title: tPush(lang, 'challengeStarted.title'),
          body,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'challenge_friend_finished': {
        const name = (sentText(lang, payload, 'from_name') as string) || tPush(lang, 'common.aFriend');
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallengeLower');
        return {
          title: tPush(lang, 'challengeFriendFinished.title', { name }),
          body: tPush(lang, 'challengeFriendFinished.body', { quoted: quotedTitle(lang, title) }),
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_pool_milestone': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallengeLower');
        const pct = Number(payload.pct ?? 50);
        const remaining = Math.max(0, Number(payload.remaining ?? 0));
        const unit = ((payload.unit as string) || '').trim();
        const remainStr = poolRemaining(lang, remaining, unit);
        const nearlyThere = pct >= 80;
        const quoted = quotedTitle(lang, title);
        return {
          title: nearlyThere ? tPush(lang, 'challengePoolMilestone.titleNearly') : tPush(lang, 'challengePoolMilestone.titleHalf'),
          body: nearlyThere
            ? tPush(lang, 'challengePoolMilestone.bodyNearly', { quoted, remaining: remainStr })
            : tPush(lang, 'challengePoolMilestone.bodyHalf', { quoted, pct: `${pct}`, remaining: remainStr }),
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_completed': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallenge');
        const total = Math.max(0, Math.round(Number(payload.total ?? payload.base ?? 0)));
        const bonus = Math.max(0, Math.round(Number(payload.bonus ?? 0)));
        const quoted = quotedTitle(lang, title);
        return {
          title: tPush(lang, 'challengeCompleted.title'),
          body: bonus > 0
            ? tPush(lang, 'challengeCompleted.bodyBonus', { quoted, total: grouped(lang, total), bonus: plain(lang, bonus) })
            : tPush(lang, 'challengeCompleted.body', { quoted, total: grouped(lang, total) }),
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      // The only bad-news type in the Together set. Four endings, one type —
      // the outcome drives the copy so there's a single preference toggle and
      // a single config row to reason about.
      //
      // Tone matters here: this lands on someone who committed to something
      // with friends and didn't get it, often after a "time's running out"
      // nudge that was previously the last thing they ever heard. State what
      // happened, don't scold, and leave a door open. Normal priority — a loss
      // shouldn't ding like a win.
      case 'challenge_ended': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallenge');
        const outcome = String(payload.outcome ?? 'expired');
        const finishers = Math.max(0, Math.round(Number(payload.finishers ?? 0)));
        const roster = Math.max(0, Math.round(Number(payload.roster ?? 0)));
        const quoted = quotedTitle(lang, title);
        const body =
          outcome === 'cancelled'
            ? tPush(lang, 'challengeEnded.cancelled', { quoted })
            : outcome === 'pool_missed'
              ? tPush(lang, 'challengeEnded.poolMissed', { quoted })
              : outcome === 'missed'
                ? roster > 0
                  ? tPush(lang, 'challengeEnded.missedCount', {
                      count: pluralCount(lang, finishers, false), quoted, finishers: `${finishers}`, roster: `${roster}`,
                    })
                  : tPush(lang, 'challengeEnded.missed', { quoted })
                /* A solo run has no "nobody" — it was only ever you. */
                : roster === 1
                  ? tPush(lang, 'challengeEnded.solo', { quoted })
                  : tPush(lang, 'challengeEnded.nobody', { quoted });
        return {
          title: outcome === 'cancelled' ? tPush(lang, 'challengeEnded.titleCancelled') : tPush(lang, 'challengeEnded.title'),
          body,
          data: {
            type,
            route: `/shared-challenge?id=${payload.challenge_id}`,
            challenge_id: payload.challenge_id,
            outcome,
          },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'normal',
        };
      }

      // The open board's two endings. Both are Together types (master opt-out
      // applies) and both carry a data.route — without one the tap goes
      // nowhere, which is exactly what a config-override-only approach would
      // have shipped.
      case 'challenge_open_unclaimed': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallenge');
        return {
          // Deliberately not "nobody wanted it". The post going untaken is not
          // the user's failure and must not read like one — this is the modal
          // outcome at launch scale, and it lands on the first-time user the
          // board exists to activate.
          title: tPush(lang, 'challengeOpenUnclaimed.title'),
          body: tPush(lang, 'challengeOpenUnclaimed.body', { quoted: quotedTitle(lang, title) }),
          data: {
            type,
            route: `/shared-challenge?id=${payload.challenge_id}`,
            challenge_id: payload.challenge_id,
          },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'normal',
        };
      }

      case 'challenge_open_posted': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.aChallenge');
        const who = (sentText(lang, payload, 'from_name') as string) || tPush(lang, 'common.someone');
        return {
          title: tPush(lang, 'challengeOpenPosted.title'),
          body: tPush(lang, 'challengeOpenPosted.body', { name: who, quoted: quotedTitle(lang, title) }),
          data: { type, route: '/challenges', challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'normal',
        };
      }

      case 'challenge_expiring': {
        const title = (challengeTitle(lang, payload) as string) || tPush(lang, 'common.yourChallenge');
        const hours = Math.max(1, Math.round(Number(payload.hours_left ?? 6)));
        return {
          title: tPush(lang, 'challengeExpiring.title'),
          body: tPush(lang, 'challengeExpiring.body', { quoted: quotedTitle(lang, title), hours: `${hours}` }),
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
    }
    return undefined;
  })();

  const ttl = TTL_SECONDS[type];
  return { ...base, ...(ttl != null ? { ttl } : {}) } as PushMessage;
}

// Apply admin-level copy overrides (from notification_config) to a built message.
// Overrides are static strings — dynamic payload values are not injected.
//
// ENGLISH ONLY. An override is one string an admin typed in English in
// /admin/notifications; there is no French or Spanish version of it, so a
// member reading another language keeps the translated default instead of
// getting a lone English line.
export function applyNotifOverrides(
  msg: PushMessage,
  config: { title_override?: string | null; body_override?: string | null } | null,
  lang = 'en',
): PushMessage {
  if (!config || lang !== 'en') return msg;
  return {
    ...msg,
    ...(config.title_override ? { title: config.title_override } : {}),
    ...(config.body_override  ? { body:  config.body_override  } : {}),
  };
}
