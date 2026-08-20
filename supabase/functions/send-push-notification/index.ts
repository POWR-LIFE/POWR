// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';
import { deliverVisiblePush } from '../_shared/visiblePush.ts';
import { streakFromSessions } from '../_shared/streak.ts';
import { nudgeBudgetGate } from '../_shared/nudgeBudget.ts';
import { levelDef } from '../_shared/levels.ts';

type NotificationType =
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
  | 'challenge_ended';

// The together feature has a master opt-out (user_metadata.together_enabled).
// These types are suppressed entirely when a user has turned it off.
const TOGETHER_TYPES: NotificationType[] = [
  'friend_request', 'friend_accepted', 'challenge_invite', 'challenge_accepted',
  'challenge_started', 'challenge_friend_finished', 'challenge_pool_milestone',
  'challenge_completed', 'challenge_expiring', 'challenge_ended',
];

// Types that should NOT land in the in-app "Recent" feed. The two live-actionable
// types already have a home in the "Needs you" section (driven off their source
// tables), and the rest are transient "do something now" nudges with no lasting
// record value. Everything else is logged — new event types appear by default.
const FEED_EXCLUDED: Set<NotificationType> = new Set([
  'friend_request', 'challenge_invite',
  'daily_reminder', 'inactivity_nudge', 'check_in_reminder',
  'streak_at_risk', 'weekly_challenge_expiry',
]);

// Coarse bucket the client renders an icon/accent from.
function categoryFor(type: NotificationType): 'social' | 'rewards' | 'activity' | 'system' {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
    case 'challenge_invite':
    case 'challenge_accepted':
    case 'challenge_started':
    case 'challenge_friend_finished':
    case 'challenge_pool_milestone':
    case 'challenge_completed':
    case 'challenge_expiring':
    case 'challenge_ended':
      return 'social';
    case 'reward_unlocked':
    case 'points_milestone':
    case 'vault_unlocked':
    case 'vault_ready':
    case 'vault_granted':
    case 'vault_banked':
      return 'rewards';
    case 'level_up':
      return 'rewards';
    case 'session_completed':
    case 'session_upgraded':
    case 'sleep_target_met':
    case 'wearable_session_recorded':
    case 'streak_lost':
    case 'streak_rescued':
      return 'activity';
    default:
      return 'system';
  }
}

interface RequestBody {
  target_user_id: string;
  type: NotificationType;
  payload?: Record<string, unknown>;
}

interface ExpoMessage {
  to: string;
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
const TTL_SECONDS: Partial<Record<NotificationType, number>> = {
  check_in_reminder:       15 * 60,      // only useful while still in the gym
  streak_at_risk:          6 * 60 * 60,  // must land before midnight
  weekly_challenge_expiry: 12 * 60 * 60,
  challenge_within_reach:  6 * 60 * 60,  // "you're close tonight" is stale by morning
  daily_reminder:          6 * 60 * 60,
  inactivity_nudge:        12 * 60 * 60,
};

// "on 16 Sep" for a vault maturity date. Falls back to a vaguer phrase rather
// than printing "Invalid Date" if the timestamp is missing or unparseable.
function formatVestDate(vestsAt: unknown): string {
  const d = new Date(String(vestsAt ?? ''));
  if (Number.isNaN(d.getTime())) return 'once it vests';
  return `on ${d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'Europe/London',
  })}`;
}

function formatSessionCompletedBody(
  partnerName?: string | null,
  currentStreak?: number | null,
  earned?: number | null,
): string {
  const name = partnerName?.trim();
  const streak = Number(currentStreak ?? 0);
  const pts = Math.max(0, Math.round(Number(earned ?? 0)));

  // Fold the points earned into the body so the single "Session recorded"
  // notification carries everything — no separate "+X pts" push needed.
  const parts: string[] = [];
  if (name) parts.push(name);
  if (pts > 0) parts.push(`+${pts.toLocaleString()} pts`);
  if (streak > 0) parts.push(`Day ${streak} streak`);

  return parts.length > 0 ? parts.join(' · ') : 'Your session counted.';
}

// ---------------------------------------------------------------------------
// Notification copy per type
// ---------------------------------------------------------------------------

function buildMessage(
  type: NotificationType,
  payload: Record<string, unknown>,
  token: string,
): ExpoMessage {
  const safePoints = (() => {
    const points = Number(payload.points ?? 0);
    return Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;
  })();
  const base: Omit<ExpoMessage, 'to'> = (() => {
    switch (type) {
      case 'daily_reminder':
        return {
          title: "Time to move 💪",
          body: "Every step earns POWR. Log your activity and keep the streak alive.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };

      case 'streak_at_risk': {
        const streak = (payload.current_streak as number) ?? 0;
        return {
          title: `Your ${streak}-day streak is at risk 🔥`,
          body: "Log any activity before midnight to keep it alive.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_streak_v2',
          priority: 'high',
        };
      }

      case 'weekly_challenge_expiry': {
        const name = (payload.challenge_name as string) ?? 'Weekly Challenge';
        const progress = ((payload.progress_text as string) ?? '').trim();
        return {
          title: "Last day ⏳",
          // With a progress payload (the board nudge) the message is specific;
          // without one (legacy senders) fall back to the generic line.
          body: progress
            ? `"${name}" ends tonight — you're at ${progress}.${safePoints > 0 ? ` +${safePoints} pts if you land it.` : ''}`
            : `"${name}" expires in 24 hours. Don't miss your bonus POWR points.`,
          data: { type, route: '/(tabs)/index' }, // the weekly board lives on Home
          sound: 'default',
          channelId: 'powr_streak_v2',
        };
      }

      case 'challenge_within_reach': {
        const name = (payload.challenge_name as string) ?? 'Your weekly challenge';
        const progress = ((payload.progress_text as string) ?? '').trim();
        return {
          title: "Within reach 🎯",
          body: `"${name}" is at ${progress || 'nearly done'} — finish it${safePoints > 0 ? ` for +${safePoints} pts` : ''}.`,
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
        return {
          title: multi ? `${count} rewards unlocked 🎁` : 'New reward unlocked 🎁',
          body: multi
            ? `You've earned your way to ${count} rewards — take your pick.`
            : `You've unlocked "${rewardName || 'a reward'}". It's ready when you are.`,
          data: { type, route: '/(tabs)/rewards', reward_id: payload.reward_id, count },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'check_in_reminder': {
        return {
          title: 'POWR',
          body: "You're in. Every minute counts.",
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
        const level = String(payload.level ?? 'denied');
        return {
          title: 'Your gym check-ins are paused',
          body: level === 'while_using'
            ? "Location is set to While Using, so POWR can't check you in automatically. Set it to Always and every visit counts again."
            : "POWR can't see your gym visits right now — location access is off for the app. Takes 30 seconds to turn back on.",
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
          title: hasWithinReach ? 'Reward within reach' : `${points.toLocaleString()} POWR points 🏆`,
          body: hasWithinReach
            ? `You're close. ${pointsToUnlock.toLocaleString()} pts to unlock your ${rewardName || 'next'} reward.`
            : 'All earned. Check your rewards — something new might be waiting.',
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
          3: "We miss you 👋",
          7: "Your streak is waiting to be rebuilt 🔄",
        };
        const bodies: Record<number, string> = {
          3: "It's been 3 days. Even a short walk earns POWR points.",
          7: "7 days away — jump back in and start earning again.",
        };
        return {
          title: titles[days] ?? "Ready to get back on track?",
          body: bodies[days] ?? "Log any activity today and start your next streak.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'sleep_target_met': {
        const hours = (payload.hours as number) ?? 0;
        const points = (payload.points as number) ?? 0;
        return {
          title: "Sleep goal reached 🌙",
          body: `${hours.toFixed(1)}h of sleep earned you ${points} POWR point${points !== 1 ? 's' : ''}.`,
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
          title: earned > 0 ? 'Session recorded 🔥' : 'Session complete 🔥',
          body: formatSessionCompletedBody(partnerName, currentStreak, earned),
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
        if (earned > 0) parts.push(`+${earned.toLocaleString()} pts`);
        parts.push(`${upgradeMins}-min bonus`);

        return {
          title: 'Bonus unlocked 🔓',
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
        const count = Math.max(1, Math.round(Number(payload.count ?? 1)));
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const label = ((payload.activity_label as string) ?? '').trim();
        const what = count > 1 ? `${count} workouts synced` : (label || 'Workout') + ' synced';
        return {
          title: 'Workout synced ⌚',
          body: `${what}${points > 0 ? ` · +${points.toLocaleString()} POWR points` : ''}. No phone needed, it just counted.`,
          data: { type, route: '/(tabs)/progress', count, points },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'level_up': {
        // Fired by the vault_level_up_push ledger trigger — the same detection
        // that banks the level-up vault bonus, so it fires however the points
        // arrived (geofence, wearable, bonus) and even with the app closed.
        const level = Math.max(1, Math.round(Number(payload.level ?? 1)));
        const name = (levelDef(level)?.name ?? '').trim();
        return {
          title: `Level ${level} reached 🏅`,
          body: name
            ? `You're now ${name}. Every session got you here — keep going.`
            : `You've leveled up. Every session got you here — keep going.`,
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
        const req = String(payload.requirement_text ?? '').trim() ||
          `${Math.max(1, Math.round(Number(payload.sessions_required ?? 2)))} sessions`;
        return {
          title: `Your ${lost}-day streak ended 💔`,
          body: `Win it back: ${req} in the next ${hours}h restores the whole streak.`,
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_streak_v2',
          priority: 'high',
        };
      }

      case 'streak_rescued': {
        // current_streak is recomputed server-side below (the bridge day is
        // live by the time this sends), so "Day N" is the restored truth.
        const streak = Math.max(0, Math.round(Number(payload.current_streak ?? 0)));
        return {
          title: 'Streak saved 🔥',
          body: streak > 0
            ? `You did the work — your streak is back on Day ${streak}. Protect it tonight.`
            : 'You did the work — your streak is restored.',
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
          title: 'Vault unlocked ⚡',
          body: `+${points.toLocaleString()} POWR just vested into your balance. Spend it on something good.`,
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
          title: 'Your Vault is ready 🔓',
          body: points > 0
            ? `${points.toLocaleString()} POWR has finished vesting — hold the dial to unlock it.`
            : 'Your Vault is ready — hold the dial to unlock it.',
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
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
        return {
          title: 'Banked in your Vault 🏦',
          body: `+${points.toLocaleString()} POWR${reason ? ` from your ${reason}` : ''} went past today's cap, so it's banked. It already counts toward your level, and unlocks ${formatVestDate(payload.vests_at)}.`,
          data: { type, route: '/vault', points },
          sound: 'default',
          channelId: 'powr_rewards_v2',
        };
      }

      case 'vault_granted': {
        // Fired by notify-vault-grant when an admin banks POWR into a user's
        // Vault. Unlike vault_ready/vault_unlocked this is a gift landing, not
        // a maturity event — so it leads with the drop and only then says what
        // happens next. `note` is the admin's message when they left one.
        const points = Math.max(0, Math.round(Number(payload.points ?? 0)));
        const note = typeof payload.note === 'string' ? payload.note.trim() : '';
        const ready = payload.ready === true;

        // Deposits count toward level the moment they land (the level trigger
        // sums pending vault alongside the ledger) — worth saying, since the
        // spendable balance won't move until the door is opened.
        const detail = ready
          ? 'is waiting in your Vault. Hold the dial to unlock it.'
          : `just landed in your Vault. It's already counting toward your level, and unlocks ${formatVestDate(payload.vests_at)}.`;

        return {
          title: ready ? 'A POWR drop landed ⚡' : 'POWR banked in your Vault 🏦',
          body: `${note ? `${note} — ` : ''}${points.toLocaleString()} POWR ${detail}`,
          data: { type, route: '/vault', points, ready },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      // ── Friend graph ──────────────────────────────────────────────────────
      case 'friend_request': {
        const name = (payload.from_name as string) || 'Someone';
        return {
          title: 'New friend request 👋',
          body: `${name} wants to team up on POWR.`,
          data: { type, route: '/friends', from_user_id: payload.from_user_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'friend_accepted': {
        const name = (payload.from_name as string) || 'Your friend';
        return {
          title: "You're connected 🤝",
          body: `${name} accepted your friend request. Take on a challenge together.`,
          data: { type, route: '/friends', from_user_id: payload.from_user_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      // ── Shared challenges ─────────────────────────────────────────────────
      case 'challenge_invite': {
        const name = (payload.from_name as string) || 'A friend';
        const title = (payload.title as string) || 'a challenge';
        return {
          title: `${name} invited you 🤜🤛`,
          body: `Take on "${title}" together — tap to join.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'challenge_accepted': {
        const name = (payload.from_name as string) || 'A friend';
        const title = (payload.title as string) || 'your challenge';
        const accepted = Math.max(0, Math.round(Number(payload.accepted_count ?? 0)));
        const total = Math.max(0, Math.round(Number(payload.total_count ?? 0)));
        const tail = accepted > 0 && total > 0 ? ` — ${accepted} of ${total} in so far.` : '';
        return {
          title: `${name} is in 🤜🤛`,
          body: `${name} accepted "${title}".${tail}`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_started': {
        const title = (payload.title as string) || 'Your challenge';
        return {
          title: 'Challenge on 🔥',
          body: `"${title}" has started — everyone's in. Get your part done.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'challenge_friend_finished': {
        const name = (payload.from_name as string) || 'A friend';
        const title = (payload.title as string) || 'your challenge';
        return {
          title: `${name} finished their part 💪`,
          body: `They're done with "${title}". Finish yours to lock in the group bonus.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_pool_milestone': {
        const title = (payload.title as string) || 'your challenge';
        const pct = Number(payload.pct ?? 50);
        const remaining = Math.max(0, Number(payload.remaining ?? 0));
        const unit = ((payload.unit as string) || '').trim();
        const remainStr = `${remaining.toLocaleString()}${unit ? ` ${unit}` : ''}`.trim();
        const nearlyThere = pct >= 80;
        return {
          title: nearlyThere ? 'Almost there 🔥' : 'Halfway there 🏁',
          body: nearlyThere
            ? `Your group's nearly cracked "${title}" — just ${remainStr} left in the pool.`
            : `Your group's hit ${pct}% of "${title}" — ${remainStr} to go together.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_completed': {
        const title = (payload.title as string) || 'Your challenge';
        const total = Math.max(0, Math.round(Number(payload.total ?? payload.base ?? 0)));
        const bonus = Math.max(0, Math.round(Number(payload.bonus ?? 0)));
        const bonusText = bonus > 0 ? ` (incl. +${bonus} together bonus)` : '';
        return {
          title: 'Challenge complete 🎉',
          body: `"${title}" done — +${total.toLocaleString()} POWR${bonusText}.`,
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
        const title = (payload.title as string) || 'Your challenge';
        const outcome = String(payload.outcome ?? 'expired');
        const finishers = Math.max(0, Math.round(Number(payload.finishers ?? 0)));
        const roster = Math.max(0, Math.round(Number(payload.roster ?? 0)));
        const body =
          outcome === 'cancelled'
            ? `"${title}" was cancelled before it finished.`
            : outcome === 'pool_missed'
              ? `"${title}" ended — the group came up short of the target this time.`
              : outcome === 'missed'
                ? roster > 0
                  ? `"${title}" finished without you — ${finishers} of ${roster} made it.`
                  : `"${title}" finished without you this time.`
                /* A solo run has no "nobody" — it was only ever you. */
                : roster === 1
                  ? `"${title}" ended — time ran out on this one.`
                  : `"${title}" ended — nobody finished this one.`;
        return {
          title: outcome === 'cancelled' ? 'Challenge cancelled' : 'Challenge over',
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

      case 'challenge_expiring': {
        const title = (payload.title as string) || 'Your challenge';
        const hours = Math.max(1, Math.round(Number(payload.hours_left ?? 6)));
        return {
          title: 'Challenge ending soon ⏰',
          body: `"${title}" ends in ${hours}h — finish your part to earn the group bonus.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
    }
  })();

  const ttl = TTL_SECONDS[type];
  return { to: token, ...base, ...(ttl != null ? { ttl } : {}) };
}

// Apply admin-level copy overrides (from notification_config) to a built message.
// Overrides are static strings — dynamic payload values are not injected.
function applyNotifOverrides(
  msg: ExpoMessage,
  config: { title_override?: string | null; body_override?: string | null } | null,
): ExpoMessage {
  if (!config) return msg;
  return {
    ...msg,
    ...(config.title_override ? { title: config.title_override } : {}),
    ...(config.body_override  ? { body:  config.body_override  } : {}),
  };
}

// Streak recompute now lives in ../_shared/streak.ts (single copy shared with
// claim-points, bridge-day aware for streak rescues). We still never read
// user_streaks.current_streak here — see that module for why.

// Record a gated (never-attempted) send in push_send_log so the admin panel can
// show WHY a user got no push, not just that nothing arrived. Best-effort.
async function logSkip(supabase: any, userId: string, type: string, reason: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('push_send_log')
      .insert({ user_id: userId, type, status: 'skipped', skip_reason: reason });
    if (error) console.warn('[send-push-notification] skip log failed:', error);
  } catch (err) {
    console.warn('[send-push-notification] skip log failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const body: RequestBody = await req.json();
    const { target_user_id, type, payload: rawPayload = {} } = body;
    let payload = rawPayload;

    if (!target_user_id || !type) {
      return new Response(JSON.stringify({ error: 'target_user_id and type are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Caller authorization ────────────────────────────────────────────────
    // Deployed verify_jwt=false (pg_net DB triggers can't mint JWTs), so the
    // gate lives here instead. Three ways in, everything else is a 401:
    //   1. service-role bearer  — edge-function-to-edge-function (notifyPush,
    //      claim-points, terra-webhook, the dispatchers…)
    //   2. shared cron token    — pg_cron + DB triggers (x-resolve-token,
    //      verified against Vault via verify_resolve_token)
    //   3. a user's own JWT     — client invoke, but ONLY to notify itself
    // Without this, any caller on the internet could push arbitrary copy to
    // arbitrary users through the type gates below.
    {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      let authorized = serviceKey.length > 0 && bearer === serviceKey;

      if (!authorized) {
        const cronToken = req.headers.get('x-resolve-token') ?? '';
        if (cronToken) {
          const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: cronToken });
          authorized = valid === true;
        }
      }

      // User JWTs may only fire the receipts the client legitimately sends
      // for itself (the HealthKit/Health Connect sync path) — not arbitrary
      // types with spoofed payloads.
      const USER_CALLABLE: NotificationType[] = ['wearable_session_recorded', 'sleep_target_met'];
      if (!authorized && bearer && USER_CALLABLE.includes(type)) {
        const { data: userData } = await supabase.auth.getUser(bearer);
        authorized = !!userData?.user?.id && userData.user.id === target_user_id;
      }

      if (!authorized) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Check admin-level notification config (global kill-switch + copy overrides).
    // Fetched once here; overrides are applied to every message built below.
    const { data: notifConfig } = await supabase
      .from('notification_config')
      .select('enabled, title_override, body_override, class, daily_cap')
      .eq('type', type)
      .maybeSingle();

    if (notifConfig?.enabled === false) {
      await logSkip(supabase, target_user_id, type, 'admin_disabled');
      return new Response(JSON.stringify({ skipped: true, reason: 'admin_disabled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Anti-bombardment budget: nudge-class types share one daily pool per
    // user (local day), and any type can carry its own daily_cap (e.g. the
    // wearable receipt caps at 1/day so Terra backfills can't machine-gun).
    // Fails open — see _shared/nudgeBudget.ts.
    {
      const budgetSkip = await nudgeBudgetGate(
        supabase, target_user_id, type,
        notifConfig?.class ?? null, notifConfig?.daily_cap ?? null,
      );
      if (budgetSkip) {
        await logSkip(supabase, target_user_id, type, budgetSkip);
        return new Response(JSON.stringify({ skipped: true, reason: budgetSkip }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Vault rollout gate. A user outside the rollout has no Vault surface, so a
    // vault push would deep-link them to a screen that bounces them straight
    // back. Scoped to vault_* types ONLY — every other push is untouched by
    // this block.
    //
    // ⚠ FAILS OPEN on any error. This is the shared push path for the whole
    // app; an RPC hiccup must not silently swallow notifications. The rollout
    // stages a launch, it protects nothing, so a stray push is a far cheaper
    // failure than a mute nobody notices.
    if (type.startsWith('vault_')) {
      try {
        const { data: hasVault, error: accessErr } = await supabase
          .rpc('vault_has_access', { p_user: target_user_id });
        if (!accessErr && hasVault === false) {
          await logSkip(supabase, target_user_id, type, 'vault_rollout');
          return new Response(JSON.stringify({ skipped: true, reason: 'vault_rollout' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        console.warn('[send-push] vault rollout check failed, allowing:', err);
      }
    }

    // Check notification preferences. session_upgraded (the 40-min tier bonus)
    // has no toggle of its own — it rides the session_completed preference so a
    // user who muted session pushes doesn't get the upgrade one either.
    // vault_unlocked likewise rides points_milestone: both are "your points
    // moved" moments, and notification_preferences has no column for new types.
    // wearable_session_recorded, level_up and streak_rescue have real columns
    // (20260723000001); streak_lost/streak_rescued share the streak_rescue
    // switch — one story, one toggle.
    //
    // A type mapped to NULL has no preference gate at all. Do not let one fall
    // through to `type` unless the column really exists — selecting a
    // non-existent column 400s on every send (harmless today only because the
    // error object is discarded), and mapping it to an unrelated toggle would
    // let muting that toggle silently mute this too. location_permission_lost
    // is NULL by design: a one-shot setup notice (the dispatcher's send-log
    // dedup guarantees once per regression), not a recurring nudge to opt out
    // of; the admin kill-switch in notification_config still covers it.
    const prefColumn: string | null =
      type === 'location_permission_lost' ? null
      : type === 'challenge_within_reach' ? 'weekly_challenge_expiry' // one weekly-challenge-nudges toggle
      : type === 'session_upgraded' ? 'session_completed'
      : type === 'vault_unlocked' ? 'points_milestone'
      : type === 'vault_ready' ? 'points_milestone'
      : type === 'vault_granted' ? 'points_milestone'
      : type === 'vault_banked' ? 'points_milestone'
      : type === 'wearable_session_recorded' ? 'wearable_session'
      : type === 'streak_lost' ? 'streak_rescue'
      : type === 'streak_rescued' ? 'streak_rescue'
      : type;
    if (prefColumn) {
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select(prefColumn)
        .eq('user_id', target_user_id)
        .maybeSingle();

      if (prefs && prefs[prefColumn] === false) {
        await logSkip(supabase, target_user_id, type, 'user_preference');
        return new Response(JSON.stringify({ skipped: true, reason: 'user_preference' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Master opt-out: a user who turned the Together feature off in settings
    // (user_metadata.together_enabled === false) receives none of its pushes.
    if (TOGETHER_TYPES.includes(type)) {
      const { data: u } = await supabase.auth.admin.getUserById(target_user_id);
      if (u?.user?.user_metadata?.together_enabled === false) {
        await logSkip(supabase, target_user_id, type, 'together_disabled');
        return new Response(JSON.stringify({ skipped: true, reason: 'together_disabled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // For streak_at_risk: compute the streak directly from sessions so the
    // notification always reflects the same value the app shows, regardless of
    // whether user_streaks is stale.
    if (type === 'streak_at_risk') {
      const computedStreak = await streakFromSessions(supabase, target_user_id);

      // A 1–2 day "streak" at risk isn't worth an evening interruption —
      // admin-tunable floor (system_config.streak_at_risk_min_streak).
      let minStreak = 3;
      try {
        const { data: minRow } = await supabase
          .from('system_config')
          .select('value')
          .eq('key', 'streak_at_risk_min_streak')
          .maybeSingle();
        minStreak = Math.max(1, parseInt(minRow?.value ?? '3', 10) || 3);
      } catch { /* keep default */ }

      if (computedStreak === 0 || computedStreak < minStreak) {
        const reason = computedStreak === 0 ? 'no_active_streak' : 'below_min_streak';
        await logSkip(supabase, target_user_id, type, reason);
        return new Response(JSON.stringify({ skipped: true, reason }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      payload = { ...payload, current_streak: computedStreak };
    }

    // The bridge day is live by the time the rescue-completion push sends, so
    // the recompute here yields the RESTORED streak for the "Day N" copy.
    if (type === 'streak_rescued') {
      const computedStreak = await streakFromSessions(supabase, target_user_id);
      if (computedStreak > 0) payload = { ...payload, current_streak: computedStreak };
    }

    // For points_milestone: derive a dynamic "within reach" payload from the
    // next active reward when callers only send current points.
    if (type === 'points_milestone') {
      const points = Number(payload.points ?? 0);
      const hasExplicitRemaining =
        payload.points_to_unlock !== undefined || payload.pointsToUnlock !== undefined;
      const hasExplicitRewardName =
        payload.reward_name !== undefined || payload.rewardName !== undefined;

      if (!hasExplicitRemaining || !hasExplicitRewardName) {
        const { data: nextReward, error: rewardError } = await supabase
          .from('rewards')
          .select('title, powr_cost')
          .eq('active', true)
          .gt('powr_cost', points)
          .order('powr_cost', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!rewardError && nextReward?.powr_cost) {
          const rewardCost = Number(nextReward.powr_cost);
          const remaining = Math.max(0, Math.ceil(rewardCost - points));
          const atOrAboveWithinReachThreshold = points >= rewardCost * 0.8;

          payload = {
            ...payload,
            points,
            points_to_unlock: atOrAboveWithinReachThreshold ? remaining : undefined,
            reward_name: atOrAboveWithinReachThreshold ? nextReward.title : undefined,
          };
        } else {
          payload = { ...payload, points };
        }
      }
    }

    if (type === 'session_completed' || type === 'session_upgraded') {
      const sessionId = String(payload.session_id ?? '').trim();

      if (sessionId) {
        const { data: session } = await supabase
          .from('activity_sessions')
          .select('user_id, partner_id')
          .eq('id', sessionId)
          .maybeSingle();

        if (session) {
          payload = { ...payload, user_id: session.user_id };

          if (session.partner_id) {
            const { data: partner } = await supabase
              .from('partners')
              .select('name')
              .eq('id', session.partner_id)
              .maybeSingle();

            if (partner?.name) {
              payload = { ...payload, partner_name: partner.name };
            }
          }

          const computedStreak = await streakFromSessions(supabase, session.user_id);
          if (computedStreak > 0) {
            payload = { ...payload, current_streak: computedStreak };
          }

          // Only session_completed re-derives `earned` from the ledger — it has a
          // single 'earn' row at that point. session_upgraded carries its delta
          // explicitly (the session already has 2+ 'earn' rows, so a single-row
          // lookup here would be ambiguous).
          if (type === 'session_completed') {
            const { data: txn } = await supabase
              .from('point_transactions')
              .select('amount')
              .eq('session_id', sessionId)
              .eq('type', 'earn')
              .maybeSingle();

            if (txn?.amount !== undefined && txn.amount !== null) {
              payload = { ...payload, earned: txn.amount };
            }
          }
        }
      }
    }

    // Persist an in-app activity-feed row before touching push tokens, so the
    // moment has a durable home even when no device push can land (permission
    // denied / no registered token). Reuses the exact push copy so the feed item
    // reads identically. Best-effort: a feed-write failure must never break the
    // push path.
    if (!FEED_EXCLUDED.has(type)) {
      try {
        const rawSample = buildMessage(type, payload, '');
        const sample = applyNotifOverrides(rawSample, notifConfig);
        const route =
          typeof sample.data?.route === 'string' ? sample.data.route : null;
        await supabase.from('user_activity').insert({
          user_id: target_user_id,
          type,
          category: categoryFor(type),
          title: sample.title,
          body: sample.body,
          route,
          data: sample.data ?? {},
        });
      } catch (feedErr) {
        console.warn('[send-push-notification] activity-feed write failed:', feedErr);
      }
    }

    // Fetch push tokens for the target user. device_token + platform come along
    // because Android now takes the direct FCM transport (see below).
    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('expo_push_token, device_token, platform')
      .eq('user_id', target_user_id);

    if (tokenError) throw tokenError;
    if (!tokens || tokens.length === 0) {
      await logSkip(supabase, target_user_id, type, 'no_tokens');
      return new Response(JSON.stringify({ skipped: true, reason: 'no_tokens' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build once and let deliverVisiblePush fan out per device — the copy is
    // identical across a user's devices, only the transport differs. Android
    // rows with a device_token go direct via FCM v1 at HIGH priority; iOS and
    // any row without one stay on Expo, where deliverExpoMessages still reads
    // the tickets, prunes DeviceNotRegistered inline and confirms via the
    // background receipt poll. Same single inline round-trip as before, so no
    // added latency for callers that await this (e.g. claim-points).
    //
    // WHY the Android split: on 2026-08-09 an Expo-routed visible push sat ~25
    // minutes behind FCM-direct wakes on the same handset during the same radio
    // outage — including wakes queued later that flushed the moment the link
    // returned. _shared/visiblePush.ts carries the measurements.
    const message = applyNotifOverrides(buildMessage(type, payload, ''), notifConfig);
    const { to: _unused, ...content } = message;

    const result = await deliverVisiblePush(supabase, tokens, content, {
      userId: target_user_id,
      type,
    });

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-push-notification]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
