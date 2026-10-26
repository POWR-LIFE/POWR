// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';
import { deliverVisiblePush } from '../_shared/visiblePush.ts';
import { streakFromSessions } from '../_shared/streak.ts';
import { nudgeBudgetGate } from '../_shared/nudgeBudget.ts';
import { languagesFor } from '../_shared/i18n/index.ts';
// The words of every push (per type, per language) live in _shared/pushCopy.ts,
// pure so Jest can test them; this function decides whether and to whom.
import { applyNotifOverrides, buildMessage, type NotificationType } from '../_shared/pushCopy.ts';

// The together feature has a master opt-out (user_metadata.together_enabled).
// These types are suppressed entirely when a user has turned it off.
const TOGETHER_TYPES: NotificationType[] = [
  'friend_request', 'friend_accepted', 'challenge_invite', 'challenge_accepted',
  'challenge_started', 'challenge_friend_finished', 'challenge_pool_milestone',
  'challenge_completed', 'challenge_expiring', 'challenge_ended',
  'challenge_open_unclaimed', 'challenge_open_posted',
];

// Types that should NOT land in the in-app "Recent" feed. The two live-actionable
// types already have a home in the "Needs you" section (driven off their source
// tables), and the rest are transient "do something now" nudges with no lasting
// record value. Everything else is logged — new event types appear by default.
const FEED_EXCLUDED: Set<NotificationType> = new Set([
  'friend_request', 'challenge_invite',
  'daily_reminder', 'inactivity_nudge', 'check_in_reminder',
  'streak_at_risk', 'weekly_challenge_expiry',
  // "someone posted on the board" is a right-now prompt, not a record. The
  // conversion receipt is NOT excluded: a challenge changing state is history.
  'challenge_open_posted',
  // Yesterday's rank and an unmet gate are both stale the moment they change —
  // the board itself is the record. (event_results_revealed IS logged: final.)
  'event_rank_daily', 'event_gate_reminder',
  // "It's on" and "tonight" mean nothing the day after. The announcement IS
  // logged: the event it names stays joinable until it locks.
  'event_kickoff', 'event_doors_open',
  // A Series gap or pass is stale within hours; the board is the record.
  'series_rival', 'series_passed', 'series_moment',
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
    case 'challenge_open_unclaimed':
    case 'challenge_open_posted':
    case 'event_results_revealed':
    case 'event_rank_daily':
    case 'event_gate_reminder':
    case 'event_announced':
    case 'event_kickoff':
    case 'event_doors_open':
    case 'gym_quiet_nudge':
    case 'gym_on_powr':
    case 'series_rival':
    case 'series_passed':
    case 'series_moment':
      return 'social';
    case 'reward_unlocked':
    case 'points_milestone':
    case 'vault_unlocked':
    case 'vault_ready':
    case 'vault_granted':
    case 'vault_banked':
      return 'rewards';
    case 'creator_invite_eligible':
    case 'creator_invite_approved':
    case 'affiliate_milestone':
    case 'affiliate_conversion':
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

// Fan-out shape: service-role / cron-token callers only (see the auth block).
interface BatchRequestBody {
  targets: RequestBody[];
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
// Per-target pipeline
// ---------------------------------------------------------------------------

// Hard ceiling on one batch call. Every target costs ~10 DB round-trips plus a
// push-provider call, all inside ONE request's 2s CPU / 150s idle budget — an
// unbounded array would take the whole batch down with it, not just the tail.
const MAX_BATCH_TARGETS = 200;
const BATCH_CONCURRENCY = 8;

type NotifConfigRow = {
  enabled: boolean | null;
  title_override: string | null;
  body_override: string | null;
  class: string | null;
  daily_cap: number | null;
} | null;
type ConfigCache = Map<string, Promise<NotifConfigRow>>;

type ProcessOutcome =
  | { skipped: true; reason: string }
  | { ok: true; result: unknown };

// notification_config is per TYPE, not per user, so a batch of 90
// daily_reminders would otherwise run the identical query 90 times. The cache
// holds the in-flight promise (concurrent workers share one fetch) and lives
// for one batch only — never module scope, so an admin flipping the
// kill-switch still lands on the very next call. A failed read is evicted
// rather than cached: one hiccup must not fail the kill-switch open for the
// whole batch.
function loadNotifConfig(supabase: any, type: string, cache: ConfigCache | null): Promise<NotifConfigRow> {
  const hit = cache?.get(type);
  if (hit) return hit;
  const pending: Promise<NotifConfigRow> = Promise.resolve(
    supabase
      .from('notification_config')
      .select('enabled, title_override, body_override, class, daily_cap')
      .eq('type', type)
      .maybeSingle(),
  ).then(({ data, error }: any) => {
    if (error) {
      cache?.delete(type);
      throw error;
    }
    return data ?? null;
  });
  cache?.set(type, pending);
  return pending;
}

// One target through every gate, in order, then delivery. Shared verbatim by
// the single-target and batch paths so the two can never drift: a push that
// would be skipped alone is skipped in a batch, for the same logged reason.
// Returns the exact object the single-target path has always serialised.
// Throws only where the inline version did (token read failure).
async function processOne(
  supabase: any,
  target_user_id: string,
  type: NotificationType,
  rawPayload: Record<string, unknown>,
  configCache: ConfigCache | null,
  // The batch path resolves every target's language in one read up front;
  // the single path leaves this undefined and reads it below.
  presetLang?: string,
): Promise<ProcessOutcome> {
  let payload = rawPayload;

  // Check admin-level notification config (global kill-switch + copy overrides).
  // Fetched once here; overrides are applied to every message built below.
  const notifConfig = await loadNotifConfig(supabase, type, configCache);

  if (notifConfig?.enabled === false) {
    await logSkip(supabase, target_user_id, type, 'admin_disabled');
    return { skipped: true, reason: 'admin_disabled' };
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
      return { skipped: true, reason: budgetSkip };
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
        return { skipped: true, reason: 'vault_rollout' };
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
    // Account-level one-shots, not recurring nudges: no toggle, admin kill-switch only.
    : type === 'creator_invite_eligible' ? null
    : type === 'creator_invite_approved' ? null
    : type === 'affiliate_milestone' ? null
    : type === 'affiliate_conversion' ? null
    // You registered for the event; the result of it is not a nudge to opt
    // out of. Admin kill-switch only.
    : type === 'event_results_revealed' ? null
    // Event-scoped and week-limited: controlled per event by the admin
    // (live_events.notify_*_at + Send now), killed globally in
    // notification_config. No preference column exists for them, so mapping
    // to `type` would 400 on every send — see the warning above.
    // Both Series pushes ride one switch (20261020150000): "Autumn Series".
    : type === 'series_rival' ? 'series_updates'
    : type === 'series_passed' ? 'series_updates'
    : type === 'series_moment' ? 'series_updates'
    : type === 'event_rank_daily' ? null
    : type === 'event_gate_reminder' ? null
    // Registrant one-offs: same reasoning as the pulses above.
    : type === 'event_kickoff' ? null
    : type === 'event_doors_open' ? null
    // A gym's new event is an announcement to people who haven't opted in to
    // it, so it honours the Announcements switch (20260626000001).
    : type === 'event_announced' ? 'announcements'
    // A gym reaching out to someone who has drifted is an announcement too.
    : type === 'gym_quiet_nudge' ? 'announcements'
    // "<gym> is on POWR" is an announcement from POWR about the gym.
    : type === 'gym_on_powr' ? 'announcements'
    : type === 'challenge_within_reach' ? 'weekly_challenge_expiry' // one weekly-challenge-nudges toggle
    : type === 'session_upgraded' ? 'session_completed'
    : type === 'vault_unlocked' ? 'points_milestone'
    : type === 'vault_ready' ? 'points_milestone'
    : type === 'vault_granted' ? 'points_milestone'
    : type === 'vault_banked' ? 'points_milestone'
    : type === 'wearable_session_recorded' ? 'wearable_session'
    : type === 'streak_lost' ? 'streak_rescue'
    : type === 'streak_rescued' ? 'streak_rescue'
    // The unclaimed-post receipt IS a challenge_started event (your post is
    // now running solo), so it rides that toggle rather than earning one.
    : type === 'challenge_open_unclaimed' ? 'challenge_started'
    // challenge_open_posted has a real column of its own (20260821…): the
    // grouped switch is "Friend activity", and a stranger's board post is
    // not that. Falling through to `type` here would have 400'd on every
    // send and left the opt-out decorative — see the warning above.
    : type;
  if (prefColumn) {
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(prefColumn)
      .eq('user_id', target_user_id)
      .maybeSingle();

    if (prefs && prefs[prefColumn] === false) {
      await logSkip(supabase, target_user_id, type, 'user_preference');
      return { skipped: true, reason: 'user_preference' };
    }
  }

  // Master opt-out: a user who turned the Together feature off in settings
  // (user_metadata.together_enabled === false) receives none of its pushes.
  if (TOGETHER_TYPES.includes(type)) {
    const { data: u } = await supabase.auth.admin.getUserById(target_user_id);
    if (u?.user?.user_metadata?.together_enabled === false) {
      await logSkip(supabase, target_user_id, type, 'together_disabled');
      return { skipped: true, reason: 'together_disabled' };
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
      return { skipped: true, reason };
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

  // The language this person reads (profiles.language through the server's
  // live-language gate, so 'en' until a language is switched on). Read only
  // once every gate has passed; never throws — a failed read means English.
  const lang = presetLang ?? (await languagesFor(supabase, [target_user_id])).get(target_user_id) ?? 'en';

  // Persist an in-app activity-feed row before touching push tokens, so the
  // moment has a durable home even when no device push can land (permission
  // denied / no registered token). Reuses the exact push copy so the feed item
  // reads identically. Best-effort: a feed-write failure must never break the
  // push path.
  if (!FEED_EXCLUDED.has(type)) {
    try {
      const rawSample = buildMessage(type, payload, lang);
      const sample = applyNotifOverrides(rawSample, notifConfig, lang);
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
    return { skipped: true, reason: 'no_tokens' };
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
  const content = applyNotifOverrides(buildMessage(type, payload, lang), notifConfig, lang);

  const result = await deliverVisiblePush(supabase, tokens, content, {
    userId: target_user_id,
    type,
  });

  return { ok: true, result };
}

type BatchResult = {
  target_user_id: string | null;
  type: string | null;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
};

// Run a batch with bounded concurrency. Results come back in input order, and
// a target that throws is ONE failed entry — never a failed batch, or a single
// bad row would cost every other user in the tick their nudge.
//
// Targets for the same user run one after another, never side by side: the
// nudge budget is a read-then-send check against push_send_log, so two
// concurrent sends to one user would both see an empty day and both go out.
async function processBatch(supabase: any, targets: any[]): Promise<BatchResult[]> {
  const results: BatchResult[] = new Array(targets.length);
  const configCache: ConfigCache = new Map();
  // Every target's language in one profiles read (≤ 200 targets per batch),
  // not one per push. Never throws: a failed read sends in English.
  const languages = await languagesFor(
    supabase,
    targets.map((t) => t?.target_user_id).filter((id): id is string => typeof id === 'string' && !!id),
  );

  const lanes = new Map<string, number[]>();
  targets.forEach((t, i) => {
    const key = typeof t?.target_user_id === 'string' && t.target_user_id ? t.target_user_id : `#${i}`;
    const lane = lanes.get(key);
    if (lane) lane.push(i); else lanes.set(key, [i]);
  });

  async function runTarget(i: number): Promise<BatchResult> {
    const t = targets[i];
    const target_user_id = typeof t?.target_user_id === 'string' ? t.target_user_id : null;
    const type = typeof t?.type === 'string' ? t.type : null;
    if (!target_user_id || !type) {
      return { target_user_id, type, status: 'failed', reason: 'target_user_id and type are required' };
    }
    try {
      if (
        t.payload !== undefined &&
        (t.payload === null || typeof t.payload !== 'object' || Array.isArray(t.payload))
      ) {
        return { target_user_id, type, status: 'failed', reason: 'payload must be an object' };
      }
      const payload = t.payload ?? {};
      const outcome = await processOne(
        supabase, target_user_id, type as NotificationType, payload, configCache,
        languages.get(target_user_id) ?? 'en',
      );
      return 'skipped' in outcome
        ? { target_user_id, type, status: 'skipped', reason: outcome.reason }
        : { target_user_id, type, status: 'sent' };
    } catch (err) {
      console.error(`[send-push-notification] batch target ${type} → ${target_user_id} failed:`, err);
      return { target_user_id, type, status: 'failed', reason: String(err) };
    }
  }

  const queue = [...lanes.values()];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, async () => {
    while (cursor < queue.length) {
      const lane = queue[cursor++];
      for (const i of lane) results[i] = await runTarget(i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
    // Two request shapes:
    //   { target_user_id, type, payload? }               — one push (every caller but one)
    //   { targets: [{ target_user_id, type, payload? }] } — a fan-out in ONE call
    // The batch shape exists because Supabase rate-limits function-to-function
    // fetches (~30/min observed on this project): dispatch-daily-nudges calling
    // once per user dropped ~60 of ~90 morning reminders a day.
    const body: RequestBody | BatchRequestBody = await req.json();
    const isBatch = (body as BatchRequestBody)?.targets !== undefined;
    const { target_user_id, type, payload: rawPayload = {} } = body as RequestBody;

    if (isBatch) {
      const targets = (body as BatchRequestBody).targets;
      if (!Array.isArray(targets)) return json({ error: 'targets must be an array' }, 400);
      if (targets.length > MAX_BATCH_TARGETS) {
        return json({ error: `too many targets (max ${MAX_BATCH_TARGETS})` }, 400);
      }
    } else if (!target_user_id || !type) {
      return json({ error: 'target_user_id and type are required' }, 400);
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
      // types with spoofed payloads. Never a batch: the self-target check
      // below reads the TOP-LEVEL target_user_id, so a body carrying both that
      // and a `targets` array would otherwise authorize as "myself" and then
      // push to everyone in the array.
      const USER_CALLABLE: NotificationType[] = ['wearable_session_recorded', 'sleep_target_met'];
      if (!authorized && !isBatch && bearer && USER_CALLABLE.includes(type)) {
        const { data: userData } = await supabase.auth.getUser(bearer);
        authorized = !!userData?.user?.id && userData.user.id === target_user_id;
      }

      if (!authorized) return json({ error: 'unauthorized' }, 401);
    }

    if (isBatch) {
      const results = await processBatch(supabase, (body as BatchRequestBody).targets);
      return json({ ok: true, results });
    }

    return json(await processOne(supabase, target_user_id, type, rawPayload, null));
  } catch (err) {
    console.error('[send-push-notification]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
