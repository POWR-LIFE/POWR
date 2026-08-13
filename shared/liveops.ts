// Admin Live Ops — the interpretation layer.
//
// The RPCs in 20260812170000_admin_liveops.sql return FACTS: timestamps, raw
// event rows, counts. Everything in this file is the JUDGEMENT applied on top —
// the field semantics the e2e watcher (scripts/e2e-watch.sh) learned the hard
// way over a fortnight of walking in and out of gyms.
//
// It lives here, as pure functions, for one reason: these rules have been wrong
// before, and a rule that is wrong in SQL is invisible. Every one of them is
// covered in __tests__/liveops.test.ts.
//
// THE RULES, and what each one cost to learn:
//   • 'accepted' is not 'displayed'. accepted only proves FCM/APNs took the
//     message. delivered_at is stamped BY THE DEVICE from the code path that
//     drew the banner. On 2026-08-09 a push logged 'accepted' 3.15s after send
//     and reached the tray 25 minutes later.
//   • delivered_at is proof in ONE direction. Non-null proves display. NULL
//     proves nothing on a transport that never stamps it — only the fcm_direct
//     display path does. Calling an unstamped Expo push "never drew" would
//     invent a bug.
//   • Arming registers ~50 regions and the OS reports initial state for all of
//     them: ~230 exit rows in 14 seconds. Unfiltered, that IS the timeline.
//   • An exit for a region we never saw an enter for is OS noise, not a
//     departure.
//   • An event gap cannot distinguish "the app is dead" from "the user went
//     nowhere". We show when the device was last heard from, and never assert
//     which.

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Consecutive unanswered wakes before a device is called wake-starved. */
export const WAKE_STARVED_STREAK = 3;

/** How long after 'accepted' an fcm_direct push with no receipt is called undrawn. */
export const PUSH_RECEIPT_GRACE_MIN = 5;

/** Stuck heuristics, in minutes since check-in. */
export const STUCK_CLAIM_AFTER_MIN = 40;
export const STUCK_UPGRADE_AFTER_MIN = 55;
export const STUCK_PRESENCE_AFTER_MIN = 45;

/** Region rows this close to an 'armed' row are initial-state noise, not travel. */
export const ARM_BURST_MS = 10_000;

// ── Shapes returned by the RPCs ──────────────────────────────────────────────

export interface BoardRow {
  visit_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  partner_id: string | null;
  venue_name: string | null;
  region_id: string | null;
  platform: string | null;
  status: string;
  started_at: string;
  checked_in_at: string;
  announced_at: string | null;
  claimed_at: string | null;
  upgraded_at: string | null;
  ended_at: string | null;
  close_reason: string | null;
  last_proven_at: string | null;
  last_confirmed_at: string | null;
  completed_push_at: string | null;
  claimed_session_id: string | null;
  last_heard_at: string | null;
  last_heard_kind: string | null;
  unanswered_nudge_streak: number;
  undrawn_push_count: number;
  dwell_minutes: number;
  upgrade_minutes: number;
  is_test: boolean;
}

export interface RawEvent {
  src: 'geo' | 'visit';
  event: string;
  region_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface PushRow {
  id: string;
  type: string;
  title: string | null;
  status: string;
  skip_reason: string | null;
  error: string | null;
  transport: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface DeviceHeader {
  platform: string | null;
  app_version: string | null;
  app_build: string | null;
  ota_update_id: string | null;
  ota_channel: string | null;
  token_updated_at: string | null;
  newest_ota_on_channel: string | null;
}

export interface VisitDoc {
  visit: BoardRow & { venue_name: string | null };
  thresholds: { dwell_minutes: number; upgrade_minutes: number };
  entered_at: string | null;
  checkin_via: string | null;
  exit_detected_at: string | null;
  device: DeviceHeader | null;
  last_heard: { at: string; kind: string } | null;
  events_total: number;
  events_limit: number;
  events: RawEvent[];
  pushes: PushRow[];
  session: {
    id: string;
    type: string;
    started_at: string | null;
    ended_at: string | null;
    duration_sec: number | null;
    verification: string | null;
    trust_score: number | null;
    flagged: boolean | null;
    flag_reason: string | null;
  } | null;
  points: { amount: number; type: string; description: string | null; source: string | null; created_at: string }[];
}

// ── Time helpers ─────────────────────────────────────────────────────────────

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Seconds between two ISO stamps, or null if either is missing/unparseable. */
export function secondsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = ms(from);
  const b = ms(to);
  if (a == null || b == null) return null;
  return (b - a) / 1000;
}

export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  const t = ms(iso);
  return t == null ? null : (now - t) / 60_000;
}

/** "1h 04m" / "4m 12s" / "9s" / "-2m 30s". Compact enough for a table cell. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const sign = seconds < 0 ? '-' : '';
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${sign}${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${sign}${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${sign}${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "4m ago" / "2h 10m ago" / "just now". */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
  const mins = minutesSince(iso, now);
  if (mins == null) return 'never';
  if (mins < 1) return 'just now';
  return `${formatDuration(mins * 60)} ago`;
}

// ── Stage ────────────────────────────────────────────────────────────────────

export type StageKey = 'checked_in' | 'claimed' | 'upgraded' | 'closed' | 'abandoned';

/**
 * How far along the earn chain this visit got. Deliberately reads the STAMPS
 * rather than `status`: status is a lifecycle field that a sweep can move, while
 * claimed_at/upgraded_at are the moments points were actually awarded.
 */
export function visitStage(v: Pick<BoardRow, 'status' | 'claimed_at' | 'upgraded_at' | 'ended_at'>): StageKey {
  if (v.status === 'abandoned') return 'abandoned';
  if (v.ended_at) return 'closed';
  if (v.upgraded_at) return 'upgraded';
  if (v.claimed_at) return 'claimed';
  return 'checked_in';
}

export function stageLabel(stage: StageKey): string {
  switch (stage) {
    case 'checked_in': return 'Checked in';
    case 'claimed':    return 'Claimed';
    case 'upgraded':   return 'Upgraded';
    case 'closed':     return 'Closed';
    case 'abandoned':  return 'Abandoned';
  }
}

/** Minutes since check-in — for an open visit, that is "how long they've been in". */
export function elapsedMinutes(v: Pick<BoardRow, 'started_at' | 'ended_at'>, now: number = Date.now()): number {
  const start = ms(v.started_at) ?? now;
  const end = ms(v.ended_at) ?? now;
  return (end - start) / 60_000;
}

// ── Stuck / alert rules ──────────────────────────────────────────────────────

export type AlertKey =
  | 'claim_overdue'
  | 'upgrade_overdue'
  | 'presence_stale'
  | 'wake_starved'
  | 'push_never_drew'
  | 'ota_behind';

export interface Alert {
  key: AlertKey;
  label: string;
  detail: string;
  severity: 'warn' | 'bad';
}

/**
 * The badges on the live board.
 *
 * Only OPEN visits can be claim/upgrade/presence-stuck: a closed visit that
 * never claimed is a finished story (usually a short walk-through), not a live
 * problem to chase.
 */
export function visitAlerts(row: BoardRow, now: number = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  const open = !row.ended_at;
  const elapsed = elapsedMinutes(row, now);

  if (open && !row.claimed_at && elapsed > STUCK_CLAIM_AFTER_MIN) {
    alerts.push({
      key: 'claim_overdue',
      label: 'CLAIM OVERDUE',
      detail: `${Math.round(elapsed)}m in, no claim (threshold ${row.dwell_minutes}m)`,
      severity: 'bad',
    });
  }

  if (open && row.claimed_at && !row.upgraded_at && elapsed > STUCK_UPGRADE_AFTER_MIN) {
    alerts.push({
      key: 'upgrade_overdue',
      label: 'UPGRADE OVERDUE',
      detail: `${Math.round(elapsed)}m in, no upgrade (threshold ${row.upgrade_minutes}m)`,
      severity: 'bad',
    });
  }

  // Presence is proven by a fresh fix, so the newer of the two stamps is the one
  // that matters — last_confirmed_at moves on any confirm, last_proven_at only
  // on one that cleared the accuracy gate.
  if (open) {
    const provenMin = minutesSince(row.last_proven_at, now);
    const confirmedMin = minutesSince(row.last_confirmed_at, now);
    const freshest =
      provenMin == null ? confirmedMin
      : confirmedMin == null ? provenMin
      : Math.min(provenMin, confirmedMin);
    if (freshest != null && freshest > STUCK_PRESENCE_AFTER_MIN) {
      alerts.push({
        key: 'presence_stale',
        label: 'PRESENCE STALE',
        detail: `last proven ${formatDuration(freshest * 60)} ago`,
        severity: 'warn',
      });
    }
  }

  if (row.unanswered_nudge_streak >= WAKE_STARVED_STREAK) {
    alerts.push({
      key: 'wake_starved',
      label: 'WAKE STARVED',
      detail: `${row.unanswered_nudge_streak} wakes with no device response`,
      severity: 'bad',
    });
  }

  if (row.undrawn_push_count > 0) {
    alerts.push({
      key: 'push_never_drew',
      label: 'PUSH NEVER DREW',
      detail: `${row.undrawn_push_count} accepted, no display receipt`,
      severity: 'warn',
    });
  }

  return alerts;
}

/** ≥3 consecutive wakes with no device footprint after them. */
export function isWakeStarved(streak: number): boolean {
  return streak >= WAKE_STARVED_STREAK;
}

// ── Push verdicts ────────────────────────────────────────────────────────────

export type PushVerdictKey = 'drew' | 'never_drew' | 'no_receipt_path' | 'pending' | 'skipped' | 'failed';

export interface PushVerdict {
  key: PushVerdictKey;
  label: string;
  severity: 'good' | 'warn' | 'bad' | 'neutral';
}

/** fence_refresh is the wake loop talking to itself — it never draws a banner. */
export function isNoisePush(type: string): boolean {
  return type === 'fence_refresh';
}

/**
 * What a push row actually proves.
 *
 * The only positive proof of display is delivered_at, which ONLY the fcm_direct
 * path stamps. So an unstamped Expo-transport push is 'no_receipt_path' — we
 * cannot see whether it drew — and never 'never_drew'. Asserting failure from a
 * column that transport never writes would manufacture bugs on demand.
 */
export function pushVerdict(push: PushRow, now: number = Date.now()): PushVerdict {
  if (push.delivered_at) {
    return { key: 'drew', label: 'DISPLAYED', severity: 'good' };
  }
  if (push.status === 'skipped') {
    return { key: 'skipped', label: `SKIPPED${push.skip_reason ? ` · ${push.skip_reason}` : ''}`, severity: 'neutral' };
  }
  if (push.status === 'failed' || push.status === 'rejected') {
    return { key: 'failed', label: `FAILED${push.error ? ` · ${push.error}` : ''}`, severity: 'bad' };
  }
  if (push.transport !== 'fcm_direct') {
    return { key: 'no_receipt_path', label: 'NO RECEIPT PATH', severity: 'neutral' };
  }
  const ageMin = minutesSince(push.created_at, now) ?? 0;
  if (push.status === 'accepted' && ageMin >= PUSH_RECEIPT_GRACE_MIN) {
    return { key: 'never_drew', label: 'SENT, NEVER DREW', severity: 'bad' };
  }
  return { key: 'pending', label: 'AWAITING RECEIPT', severity: 'warn' };
}

/** Display rate over a set of aggregate push buckets, counting only the transport that can prove it. */
export function displayRate(
  buckets: { transport: string; accepted: number; drawn: number }[],
): { drawn: number; measurable: number; pct: number | null } {
  const measurable = buckets
    .filter(b => b.transport === 'fcm_direct')
    .reduce((n, b) => n + b.accepted, 0);
  const drawn = buckets
    .filter(b => b.transport === 'fcm_direct')
    .reduce((n, b) => n + b.drawn, 0);
  return { drawn, measurable, pct: measurable > 0 ? (drawn / measurable) * 100 : null };
}

// ── Timeline collapsing ──────────────────────────────────────────────────────

export interface TimelineEntry {
  key: string;
  at: string;
  src: 'geo' | 'visit';
  event: string;
  regionId: string | null;
  detail: Record<string, unknown>;
  /** Suppressible by default: OS noise, not something the user or the app did. */
  noise: boolean;
  /** Set on a collapsed arm burst. */
  collapsed?: { armed: number; enters: number; exits: number };
}

const ARM_EVENTS = new Set(['armed', 'rearm_skipped']);

/**
 * Turn the raw event feed into something a human can read.
 *
 * Two collapses, both from the watcher:
 *  1. ARM BURSTS. Arming registers every cached region and the OS immediately
 *     reports initial state for all of them — dozens of enter/exit rows inside a
 *     few seconds. They are collapsed into one "armed n regions" entry carrying
 *     the counts, so the burst is still visible but no longer IS the timeline.
 *  2. UNPAIRED EXITS. An exit for a region we never saw an enter for did not
 *     happen to this user — it is the OS telling us where they aren't. Marked
 *     noise, not dropped: the count is real information when a device is
 *     thrashing.
 *
 * Input must be ascending by created_at (the RPC returns it that way).
 */
export function collapseTimeline(events: RawEvent[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const seenEnter = new Set<string>();
  let burst: TimelineEntry | null = null;
  let burstUntil = 0;

  events.forEach((e, i) => {
    const at = Date.parse(e.created_at);
    const detail = e.detail ?? {};
    const region = e.region_id ?? null;

    if (e.src === 'geo' && ARM_EVENTS.has(e.event)) {
      // Consecutive arms inside a live burst fold into it rather than opening a
      // new one — a re-arm storm is one event to a human.
      if (burst && at <= burstUntil) {
        burst.collapsed!.armed += 1;
        burstUntil = at + ARM_BURST_MS;
        return;
      }
      burst = {
        key: `arm-${e.created_at}-${i}`,
        at: e.created_at,
        src: 'geo',
        event: 'armed',
        regionId: region,
        detail,
        noise: false,
        collapsed: { armed: 1, enters: 0, exits: 0 },
      };
      burstUntil = at + ARM_BURST_MS;
      out.push(burst);
      return;
    }

    const inBurst = burst != null && at <= burstUntil;

    if (e.src === 'geo' && e.event === 'enter') {
      if (region) seenEnter.add(region);
      if (inBurst) { burst!.collapsed!.enters += 1; return; }
      out.push({ key: `${e.created_at}-${i}`, at: e.created_at, src: e.src, event: e.event, regionId: region, detail, noise: false });
      return;
    }

    if (e.src === 'geo' && e.event === 'exit') {
      const paired = region != null && seenEnter.has(region);
      if (inBurst) { burst!.collapsed!.exits += 1; return; }
      out.push({ key: `${e.created_at}-${i}`, at: e.created_at, src: e.src, event: e.event, regionId: region, detail, noise: !paired });
      return;
    }

    // stream_tick is the dwell stream's heartbeat: one row every tick, and the
    // single highest-volume event in the table. Real, but not a story beat.
    const noise = e.event === 'stream_tick';
    out.push({ key: `${e.created_at}-${i}`, at: e.created_at, src: e.src, event: e.event, regionId: region, detail, noise });
  });

  return out;
}

// ── Stage deltas — the headline numbers ──────────────────────────────────────

export interface StageDelta {
  key: string;
  label: string;
  /** Seconds for the leg, or null when the leg never happened. */
  seconds: number | null;
  /** Why it is null. Never "unknown" — absence is itself a finding. */
  missing?: string;
  /** Signed seconds against the configured threshold, where one applies. */
  vsThresholdSec?: number | null;
  thresholdLabel?: string;
}

/**
 * enter → checked in → claimed → upgraded → exit → closed → push drawn.
 *
 * A missing leg gets a REASON, not a dash. "No OS enter delivered" is the single
 * most informative cell on this screen — on iOS the region crossing routinely
 * never arrives and the check-in comes from the arm-time burst instead.
 */
export function stageDeltas(doc: VisitDoc, now: number = Date.now()): StageDelta[] {
  const v = doc.visit;
  const dwellSec = doc.thresholds.dwell_minutes * 60;
  const upgradeSec = doc.thresholds.upgrade_minutes * 60;
  const drawnAt = doc.pushes.find(p => p.type === 'gym_session_complete' && p.delivered_at)?.delivered_at ?? null;

  const deltas: StageDelta[] = [
    {
      key: 'enter_to_checkin',
      label: 'Enter → checked in',
      seconds: secondsBetween(doc.entered_at, v.checked_in_at),
      missing: doc.entered_at ? undefined : 'no OS enter delivered — check-in came from a poll or the arm burst',
    },
    {
      key: 'checkin_to_claim',
      label: 'Checked in → claimed',
      seconds: secondsBetween(v.started_at, v.claimed_at),
      missing: v.claimed_at ? undefined : (v.ended_at ? 'closed before the dwell threshold' : 'not claimed yet'),
      vsThresholdSec: v.claimed_at ? (secondsBetween(v.started_at, v.claimed_at) ?? 0) - dwellSec : null,
      thresholdLabel: `${doc.thresholds.dwell_minutes}m`,
    },
    {
      key: 'checkin_to_upgrade',
      label: 'Checked in → upgraded',
      seconds: secondsBetween(v.started_at, v.upgraded_at),
      missing: v.upgraded_at ? undefined : (v.ended_at ? 'closed before the upgrade threshold' : 'not upgraded yet'),
      vsThresholdSec: v.upgraded_at ? (secondsBetween(v.started_at, v.upgraded_at) ?? 0) - upgradeSec : null,
      thresholdLabel: `${doc.thresholds.upgrade_minutes}m`,
    },
    {
      key: 'exit_to_close',
      label: 'Exit detected → closed',
      seconds: secondsBetween(doc.exit_detected_at, v.ended_at),
      missing: !v.ended_at ? 'still open'
        : !doc.exit_detected_at ? `no exit event — closed by ${v.close_reason ?? 'sweep'}`
        : undefined,
    },
    {
      key: 'close_to_push',
      label: 'Closed → completion push sent',
      seconds: secondsBetween(v.ended_at, v.completed_push_at),
      missing: v.completed_push_at ? undefined : (v.ended_at ? 'no completion push sent' : 'still open'),
    },
    {
      key: 'push_to_drawn',
      label: 'Push sent → banner drawn',
      seconds: secondsBetween(v.completed_push_at, drawnAt),
      missing: drawnAt ? undefined : (v.completed_push_at ? 'no display receipt from the device' : 'no push to draw'),
    },
    {
      key: 'door_to_notification',
      label: 'Door → notification',
      seconds: secondsBetween(v.started_at, drawnAt),
      missing: drawnAt ? undefined : 'the banner has not been proven to draw',
    },
  ];

  // An open visit's live clock is more useful than seven dashes.
  if (!v.ended_at) {
    deltas.unshift({
      key: 'elapsed',
      label: 'Inside for',
      seconds: (now - (ms(v.started_at) ?? now)) / 1000,
    });
  }

  return deltas;
}

// ── Device header ────────────────────────────────────────────────────────────

/** A device running no OTA shows its embedded bundle — that is a state, not a gap. */
export function otaLabel(device: Pick<DeviceHeader, 'ota_update_id'> | null | undefined): string {
  if (!device) return 'unknown';
  return device.ota_update_id ? device.ota_update_id.slice(0, 8) : 'embedded';
}

/**
 * Is this device behind the newest bundle seen on its own channel?
 *
 * "Newest seen on the channel" is the honest comparison available server-side —
 * we do not query EAS. It answers the question that matters during a field test:
 * is this handset running the fix, or the build before it?
 */
export function isOtaBehind(device: DeviceHeader | null | undefined): boolean {
  if (!device || !device.newest_ota_on_channel) return false;
  return device.ota_update_id !== device.newest_ota_on_channel;
}

/**
 * "Last heard from" — deliberately non-committal.
 *
 * A silent device may be dead, or may be a healthy iPhone whose owner has not
 * moved since Tuesday. Nothing in the data separates those, so this never
 * guesses: it reports the freshest footprint of any kind, and names its source.
 */
export function lastHeardLabel(
  at: string | null | undefined,
  kind: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!at) return 'never heard from';
  return `${formatAgo(at, now)} · ${kind ?? 'unknown source'}`;
}

// ── Check-in path ────────────────────────────────────────────────────────────

export function checkinPathLabel(via: string | null | undefined): string {
  switch (via) {
    case 'enter_poll': return 'Native enter → poll';
    case 'sweep':      return 'Background sweep';
    case null:
    case undefined:
    case 'foreground_or_unlogged':
      // The foreground check-in path logs no region event at all, so absence
      // names this bucket rather than leaving it "unknown".
      return 'Foreground / unlogged';
    default: return via;
  }
}

// ── History: journeys ────────────────────────────────────────────────────────
//
// gym_visit_journeys is the permanent per-visit FACT record (migration
// 20260813150000). It exists because two of the four tables Live Ops reads —
// geofence_region_events and push_send_log — are purged on a rolling window, so
// before it, no question about the chain could be answered beyond the retention
// horizon. The rollup distils each visit while the raw rows are still alive.
//
// Everything below is the judgement layer over those facts, same contract as the
// rest of this file: the RPC ships columns, this file decides what they mean.

export interface JourneyRow {
  visit_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  partner_id: string | null;
  venue_name: string | null;
  platform: string | null;
  is_test: boolean;
  started_at: string;
  ended_at: string | null;
  close_reason: string | null;
  claimed_at: string | null;
  upgraded_at: string | null;
  completed_push_at: string | null;
  native_enter_at: string | null;
  checkin_via: string | null;
  exit_detected_at: string | null;
  /** False = the raw evidence had already been purged when this was rolled up.
   *  Derived nulls then mean "we cannot know", never "it did not happen". */
  evidence_complete: boolean;
  nudge_count: number;
  nudge_count_upgrade: number;
  wakes_received: number;
  proofs: number;
  settled_stages: string[];
  pushes_sent: number;
  pushes_displayed: number;
  pushes_receiptable: number;
  session_duration_sec: number | null;
  points_earned: number;
  total_count: number;
}

/**
 * The searchable outcome filters.
 *
 * ⚠ KEYS ARE MIRRORED IN SQL (admin_liveops_history's CASE). Adding one here
 * without adding it there silently returns unfiltered rows — the SQL `else true`
 * branch is deliberately permissive so an unknown key can never 500 a dashboard,
 * which means a typo degrades to "no filter" rather than an error. The test
 * `HISTORY_OUTCOMES keys` pins the list; update both sides together.
 *
 * Every one is a FACT predicate — a column comparison. "Did this visit fail" is
 * not in here, because it isn't a column: a six-minute walk-through SHOULD never
 * claim, and calling that a failure would bury the real ones.
 */
export interface HistoryOutcome {
  key: string;
  label: string;
  /** What the filter actually asks of the data — shown as help text, because
   *  "never claimed" and "failed" are not the same question. */
  predicate: string;
  group: 'progress' | 'detection' | 'delivery' | 'settlement';
}

export const HISTORY_OUTCOMES: HistoryOutcome[] = [
  { key: 'all',                 label: 'All visits',            predicate: 'no filter',                                   group: 'progress' },
  { key: 'full_chain',          label: 'Full chain',            predicate: 'claimed, upgraded and a completion push sent', group: 'progress' },
  { key: 'claimed',             label: 'Claimed',               predicate: 'claimed_at is set',                            group: 'progress' },
  { key: 'never_claimed',       label: 'Never claimed',         predicate: 'claimed_at is null — includes short walk-throughs', group: 'progress' },
  { key: 'upgraded',            label: 'Upgraded',              predicate: 'upgraded_at is set',                           group: 'progress' },
  { key: 'claimed_not_upgraded',label: 'Claimed, not upgraded', predicate: 'claimed but the 40-min bonus never landed',    group: 'progress' },
  { key: 'no_os_enter',         label: 'No OS enter',           predicate: 'the OS never delivered the crossing (evidence-complete visits only)', group: 'detection' },
  { key: 'no_exit_detected',    label: 'No exit detected',      predicate: 'closed with nothing ever observing them leave', group: 'detection' },
  { key: 'no_proof',            label: 'No presence proof',     predicate: 'zero confirms cleared the accuracy gate',       group: 'detection' },
  { key: 'wake_starved',        label: 'Wake starved',          predicate: '3+ nudges sent, zero answered',                 group: 'delivery' },
  { key: 'push_never_drew',     label: 'Push never drew',       predicate: 'receiptable pushes sent, none stamped displayed', group: 'delivery' },
  { key: 'no_completion_push',  label: 'No completion push',    predicate: 'claimed and closed, but no banner was sent',    group: 'delivery' },
  { key: 'server_settled',      label: 'Server settled',        predicate: 'credit banked by the beacon, not the device',   group: 'settlement' },
  { key: 'reaper_closed',       label: 'Closed by reaper',      predicate: 'no exit detected — closed on stale presence',   group: 'settlement' },
  { key: 'evidence_expired',    label: 'Evidence expired',      predicate: 'raw rows were already purged — derived fields unknowable', group: 'settlement' },
];

export const HISTORY_OUTCOME_KEYS: string[] = HISTORY_OUTCOMES.map(o => o.key);

/** How far the chain got, from a journey row. Mirrors visitStage's rule of
 *  reading the STAMPS, not `status` (which journeys do not even carry). */
export function journeyStage(j: Pick<JourneyRow, 'claimed_at' | 'upgraded_at' | 'ended_at'>): StageKey {
  if (j.upgraded_at) return 'upgraded';
  if (j.claimed_at) return 'claimed';
  if (j.ended_at) return 'closed';
  return 'checked_in';
}

/**
 * The badges on a history row.
 *
 * Ordered worst-first so a truncated row still shows the thing worth clicking.
 * Nothing here is emitted for a journey whose evidence expired, EXCEPT the
 * expiry badge itself: scoring detection against data we no longer hold is how
 * you manufacture a 100% failure rate out of a retention policy.
 */
export function journeyFindings(j: JourneyRow): Alert[] {
  const out: Alert[] = [];

  if (!j.evidence_complete) {
    out.push({
      key: 'presence_stale',
      label: 'EVIDENCE EXPIRED',
      detail: 'raw rows purged before rollup — detection fields are unknown, not failed',
      severity: 'warn',
    });
  }

  if (j.pushes_receiptable > 0 && j.pushes_displayed === 0) {
    out.push({
      key: 'push_never_drew',
      label: 'PUSH NEVER DREW',
      detail: `${j.pushes_receiptable} receiptable push(es), no display receipt`,
      severity: 'bad',
    });
  }

  const nudges = j.nudge_count + j.nudge_count_upgrade;
  if (nudges >= WAKE_STARVED_STREAK && j.wakes_received === 0) {
    out.push({
      key: 'wake_starved',
      label: 'WAKE STARVED',
      detail: `${nudges} nudges sent, none answered`,
      severity: 'bad',
    });
  }

  if (j.evidence_complete && !j.native_enter_at) {
    out.push({
      key: 'claim_overdue',
      label: 'NO OS ENTER',
      detail: `check-in came from ${checkinPathLabel(j.checkin_via).toLowerCase()}, not the region crossing`,
      severity: 'warn',
    });
  }

  if (j.evidence_complete && j.ended_at && !j.exit_detected_at) {
    out.push({
      key: 'presence_stale',
      label: 'NO EXIT DETECTED',
      detail: `closed by ${j.close_reason ?? 'unknown'} — nothing observed them leaving`,
      severity: 'warn',
    });
  }

  if (j.settled_stages.length > 0) {
    out.push({
      key: 'wake_starved',
      label: `SERVER SETTLED · ${j.settled_stages.join(', ')}`,
      detail: 'the device never answered; the beacon banked the credit from its own evidence',
      severity: 'warn',
    });
  }

  return out;
}

// ── Trends ───────────────────────────────────────────────────────────────────

export interface TrendBucket {
  bucket: string;
  visits: number;
  evidence_complete: number;
  os_enter_delivered: number;
  claimed: number;
  upgraded: number;
  closed_by_reaper: number;
  exit_detected: number;
  server_settled: number;
  nudges_sent: number;
  wakes_received: number;
  pushes_receiptable: number;
  pushes_displayed: number;
  points_earned: number;
}

/**
 * A rate that refuses to lie.
 *
 * `measurable` is the denominator AFTER excluding everything the metric cannot
 * see, and `pct` is null when it is zero. A component that renders `pct ?? '—'`
 * therefore cannot print "0%" for "we had nothing to measure" — which is exactly
 * the mistake that made the 08-12 board read "0 pushes proven drawn" when the
 * truth was "no push that day rode a transport capable of proving it".
 */
export interface Rate {
  numerator: number;
  measurable: number;
  pct: number | null;
}

function rate(numerator: number, measurable: number): Rate {
  return { numerator, measurable, pct: measurable > 0 ? (numerator / measurable) * 100 : null };
}

/** Sum a trend series into one rate set. Denominators are per-metric on purpose. */
export function trendTotals(buckets: TrendBucket[]) {
  const sum = (pick: (b: TrendBucket) => number) => buckets.reduce((n, b) => n + pick(b), 0);
  const visits = sum(b => b.visits);
  const evidenced = sum(b => b.evidence_complete);
  return {
    visits,
    evidenceComplete: evidenced,
    /** Over EVIDENCE-COMPLETE visits only — a purged visit has no opinion. */
    osEnter: rate(sum(b => b.os_enter_delivered), evidenced),
    exitDetected: rate(sum(b => b.exit_detected), evidenced),
    /** Over all visits: claiming does not depend on raw-event retention. */
    claim: rate(sum(b => b.claimed), visits),
    upgrade: rate(sum(b => b.upgraded), visits),
    /** Over RECEIPTABLE pushes only — fcm_direct is the sole transport that
     *  stamps delivered_at, so every other send is unmeasurable, not failed. */
    pushDisplay: rate(sum(b => b.pushes_displayed), sum(b => b.pushes_receiptable)),
    /** Over nudges actually sent. */
    wakeAnswer: rate(sum(b => b.wakes_received), sum(b => b.nudges_sent)),
    reaperClosed: sum(b => b.closed_by_reaper),
    serverSettled: sum(b => b.server_settled),
    points: sum(b => b.points_earned),
  };
}
