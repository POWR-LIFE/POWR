import {
  ARM_BURST_MS,
  BoardRow,
  PushRow,
  RawEvent,
  VisitDoc,
  checkinPathLabel,
  collapseTimeline,
  displayRate,
  elapsedMinutes,
  formatAgo,
  formatDuration,
  isOtaBehind,
  isWakeStarved,
  lastHeardLabel,
  otaLabel,
  pushVerdict,
  secondsBetween,
  stageDeltas,
  visitAlerts,
  visitStage,
  partitionBoard,
} from '@/shared/liveops';

// A fixed "now" so every threshold assertion is deterministic.
const NOW = Date.parse('2026-08-12T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function boardRow(over: Partial<BoardRow> = {}): BoardRow {
  return {
    visit_id: 'v1',
    user_id: 'u1',
    username: 'tester',
    display_name: 'Tester',
    email: 'tester@example.com',
    partner_id: 'p1',
    venue_name: 'ONE LDN',
    region_id: 'p1-0',
    platform: 'ios',
    status: 'open',
    started_at: ago(10),
    checked_in_at: ago(10),
    announced_at: ago(10),
    claimed_at: null,
    upgraded_at: null,
    ended_at: null,
    close_reason: null,
    last_proven_at: ago(2),
    last_confirmed_at: ago(2),
    completed_push_at: null,
    claimed_session_id: null,
    last_heard_at: ago(2),
    last_heard_kind: 'region event',
    unanswered_nudge_streak: 0,
    undrawn_push_count: 0,
    dwell_minutes: 30,
    upgrade_minutes: 40,
    is_test: false,
    ...over,
  };
}

function pushRow(over: Partial<PushRow> = {}): PushRow {
  return {
    id: 'push1',
    type: 'gym_session_complete',
    title: 'Session complete',
    status: 'accepted',
    skip_reason: null,
    error: null,
    transport: 'fcm_direct',
    delivered_at: null,
    created_at: ago(30),
    ...over,
  };
}

function geo(event: string, atMs: number, regionId: string | null = 'p1-0'): RawEvent {
  return { src: 'geo', event, region_id: regionId, detail: {}, created_at: new Date(atMs).toISOString() };
}

describe('time formatting', () => {
  it('formats sub-minute, minute and hour spans', () => {
    expect(formatDuration(9)).toBe('9s');
    expect(formatDuration(252)).toBe('4m 12s');
    expect(formatDuration(3840)).toBe('1h 04m');
  });

  it('keeps the sign on a negative delta — beating a threshold is the good case', () => {
    expect(formatDuration(-150)).toBe('-2m 30s');
  });

  it('returns a dash rather than NaN for missing spans', () => {
    expect(formatDuration(null)).toBe('—');
    expect(secondsBetween(null, ago(1))).toBeNull();
    expect(secondsBetween(ago(1), null)).toBeNull();
    expect(formatAgo(null, NOW)).toBe('never');
  });
});

describe('visitStage', () => {
  it('reads the award stamps, not the lifecycle status', () => {
    expect(visitStage(boardRow())).toBe('checked_in');
    expect(visitStage(boardRow({ claimed_at: ago(1) }))).toBe('claimed');
    expect(visitStage(boardRow({ claimed_at: ago(5), upgraded_at: ago(1) }))).toBe('upgraded');
    expect(visitStage(boardRow({ ended_at: ago(1), status: 'closed' }))).toBe('closed');
    expect(visitStage(boardRow({ status: 'abandoned', ended_at: ago(1) }))).toBe('abandoned');
  });

  it('measures elapsed to the CLOSE for a finished visit, not to now', () => {
    const closed = boardRow({ started_at: ago(90), ended_at: ago(30) });
    expect(Math.round(elapsedMinutes(closed, NOW))).toBe(60);
  });
});

describe('stuck heuristics', () => {
  it('flags an open visit past 40m with no claim', () => {
    const alerts = visitAlerts(boardRow({ started_at: ago(41) }), NOW);
    expect(alerts.map(a => a.key)).toContain('claim_overdue');
  });

  it('does not flag at exactly the threshold — the rule is strictly greater', () => {
    const alerts = visitAlerts(boardRow({ started_at: ago(40) }), NOW);
    expect(alerts.map(a => a.key)).not.toContain('claim_overdue');
  });

  it('flags a claimed visit past 55m with no upgrade', () => {
    const alerts = visitAlerts(boardRow({ started_at: ago(56), claimed_at: ago(25) }), NOW);
    expect(alerts.map(a => a.key)).toContain('upgrade_overdue');
    expect(alerts.map(a => a.key)).not.toContain('claim_overdue');
  });

  it('flags stale presence when BOTH proof stamps are older than 45m', () => {
    const alerts = visitAlerts(
      boardRow({ started_at: ago(50), claimed_at: ago(20), last_proven_at: ago(46), last_confirmed_at: ago(46) }),
      NOW,
    );
    expect(alerts.map(a => a.key)).toContain('presence_stale');
  });

  it('takes the FRESHER of the two proof stamps — a recent confirm rescues a stale proof', () => {
    const alerts = visitAlerts(
      boardRow({ started_at: ago(50), claimed_at: ago(20), last_proven_at: ago(90), last_confirmed_at: ago(3) }),
      NOW,
    );
    expect(alerts.map(a => a.key)).not.toContain('presence_stale');
  });

  it('never calls a CLOSED visit stuck — a short walk-through is a finished story', () => {
    const alerts = visitAlerts(
      boardRow({ started_at: ago(120), ended_at: ago(60), status: 'closed', close_reason: 'exit', last_proven_at: ago(120) }),
      NOW,
    );
    expect(alerts.map(a => a.key)).toEqual([]);
  });

  it('badges a wake-starved device at three unanswered wakes, not two', () => {
    expect(isWakeStarved(2)).toBe(false);
    expect(isWakeStarved(3)).toBe(true);
    expect(visitAlerts(boardRow({ unanswered_nudge_streak: 2 }), NOW).map(a => a.key)).not.toContain('wake_starved');
    expect(visitAlerts(boardRow({ unanswered_nudge_streak: 3 }), NOW).map(a => a.key)).toContain('wake_starved');
  });

  it('badges accepted-but-never-drawn pushes', () => {
    const alerts = visitAlerts(boardRow({ undrawn_push_count: 2 }), NOW);
    const alert = alerts.find(a => a.key === 'push_never_drew');
    expect(alert?.detail).toContain('2 accepted');
  });
});

describe('pushVerdict — accepted is not displayed', () => {
  it('treats a device-stamped delivered_at as the only proof of display', () => {
    expect(pushVerdict(pushRow({ delivered_at: ago(29) }), NOW).key).toBe('drew');
  });

  it('calls an fcm_direct push with no receipt after 5 minutes "sent, never drew"', () => {
    expect(pushVerdict(pushRow({ created_at: ago(6) }), NOW).key).toBe('never_drew');
  });

  it('still waits inside the 5-minute grace window', () => {
    expect(pushVerdict(pushRow({ created_at: ago(4) }), NOW).key).toBe('pending');
  });

  it('NEVER blames a transport that cannot stamp a receipt', () => {
    // The Expo path never writes delivered_at. Reading its silence as failure
    // would invent a bug on every push the app has ever sent through Expo.
    const verdict = pushVerdict(pushRow({ transport: null, created_at: ago(120) }), NOW);
    expect(verdict.key).toBe('no_receipt_path');
    expect(verdict.severity).toBe('neutral');
  });

  it('surfaces the server gate and the platform error verbatim', () => {
    expect(pushVerdict(pushRow({ status: 'skipped', skip_reason: 'vault_rollout' }), NOW).label)
      .toContain('vault_rollout');
    expect(pushVerdict(pushRow({ status: 'rejected', error: 'DeviceNotRegistered' }), NOW).label)
      .toContain('DeviceNotRegistered');
  });

  it('counts display rate only over pushes that COULD report one', () => {
    const rate = displayRate([
      { transport: 'fcm_direct', accepted: 10, drawn: 7 },
      { transport: 'expo', accepted: 100, drawn: 0 },   // unmeasurable, must not dilute
    ]);
    expect(rate.measurable).toBe(10);
    expect(rate.pct).toBe(70);
  });

  it('reports "no measurable sends" as null rather than 0%', () => {
    expect(displayRate([{ transport: 'expo', accepted: 40, drawn: 0 }]).pct).toBeNull();
  });
});

describe('collapseTimeline — arm bursts and phantom exits', () => {
  const t0 = Date.parse('2026-08-12T09:00:00.000Z');

  it('collapses the arm burst into one entry carrying its counts', () => {
    // Arming registers every cached region; the OS reports initial state for all
    // of them within a few seconds. Unfiltered this IS the timeline.
    const events: RawEvent[] = [geo('armed', t0)];
    for (let i = 0; i < 40; i++) events.push(geo('exit', t0 + 1000 + i * 10, `region-${i}`));
    for (let i = 0; i < 5; i++) events.push(geo('enter', t0 + 2000 + i * 10, `near-${i}`));

    const timeline = collapseTimeline(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].event).toBe('armed');
    expect(timeline[0].collapsed).toEqual({ armed: 1, enters: 5, exits: 40 });
  });

  it('folds a re-arm storm into the same burst rather than opening a new one', () => {
    const events = [geo('armed', t0), geo('rearm_skipped', t0 + 2000), geo('armed', t0 + 4000)];
    const timeline = collapseTimeline(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].collapsed?.armed).toBe(3);
  });

  it('lets a crossing that lands after the burst window through as a real event', () => {
    const events = [geo('armed', t0), geo('enter', t0 + ARM_BURST_MS + 1000)];
    const timeline = collapseTimeline(events);
    expect(timeline).toHaveLength(2);
    expect(timeline[1].event).toBe('enter');
    expect(timeline[1].noise).toBe(false);
  });

  it('marks an exit with no preceding enter as noise, not a departure', () => {
    const timeline = collapseTimeline([geo('exit', t0, 'never-entered')]);
    expect(timeline[0].noise).toBe(true);
  });

  it('treats an exit that PAIRS with an earlier enter as a real departure', () => {
    const timeline = collapseTimeline([
      geo('enter', t0, 'p1-0'),
      geo('exit', t0 + 30 * 60_000, 'p1-0'),
    ]);
    expect(timeline.map(e => e.noise)).toEqual([false, false]);
  });

  it('pairs an exit against an enter that was absorbed into an arm burst', () => {
    const timeline = collapseTimeline([
      geo('armed', t0),
      geo('enter', t0 + 500, 'p1-0'),                     // swallowed by the burst…
      geo('exit', t0 + 30 * 60_000, 'p1-0'),              // …but still a real departure
    ]);
    expect(timeline).toHaveLength(2);
    expect(timeline[1].event).toBe('exit');
    expect(timeline[1].noise).toBe(false);
  });

  it('demotes stream_tick — real, but not a story beat', () => {
    const timeline = collapseTimeline([
      { src: 'visit', event: 'stream_tick', region_id: null, detail: {}, created_at: new Date(t0).toISOString() },
      { src: 'visit', event: 'claimed', region_id: null, detail: {}, created_at: new Date(t0 + 1000).toISOString() },
    ]);
    expect(timeline[0].noise).toBe(true);
    expect(timeline[1].noise).toBe(false);
  });
});

describe('stageDeltas', () => {
  function visitDoc(over: Partial<VisitDoc> = {}): VisitDoc {
    return {
      visit: boardRow({ started_at: ago(90), checked_in_at: ago(90) }),
      thresholds: { dwell_minutes: 30, upgrade_minutes: 40 },
      entered_at: null,
      checkin_via: null,
      exit_detected_at: null,
      device: null,
      last_heard: null,
      events_total: 0,
      events_limit: 600,
      events: [],
      pushes: [],
      session: null,
      points: [],
      ...over,
    };
  }

  it('measures the claim against the CONFIGURED threshold, not a hardcoded 30', () => {
    const doc = visitDoc({
      visit: boardRow({ started_at: ago(90), checked_in_at: ago(90), claimed_at: ago(58) }),
      thresholds: { dwell_minutes: 25, upgrade_minutes: 35 },
    });
    const claim = stageDeltas(doc, NOW).find(d => d.key === 'checkin_to_claim')!;
    expect(claim.seconds).toBe(32 * 60);
    expect(claim.vsThresholdSec).toBe(7 * 60);       // 32m against a 25m threshold
    expect(claim.thresholdLabel).toBe('25m');
  });

  it('explains a missing OS enter rather than printing a dash', () => {
    const enter = stageDeltas(visitDoc(), NOW).find(d => d.key === 'enter_to_checkin')!;
    expect(enter.seconds).toBeNull();
    expect(enter.missing).toMatch(/no OS enter delivered/);
  });

  it('distinguishes "not claimed yet" from "closed before the threshold"', () => {
    const open = stageDeltas(visitDoc(), NOW).find(d => d.key === 'checkin_to_claim')!;
    expect(open.missing).toBe('not claimed yet');

    const closed = stageDeltas(
      visitDoc({ visit: boardRow({ started_at: ago(90), ended_at: ago(80), status: 'closed' }) }),
      NOW,
    ).find(d => d.key === 'checkin_to_claim')!;
    expect(closed.missing).toBe('closed before the dwell threshold');
  });

  it('names the close_reason when a visit ended with no exit event', () => {
    const doc = visitDoc({
      visit: boardRow({ started_at: ago(90), ended_at: ago(10), status: 'closed', close_reason: 'stale_after_upgrade' }),
    });
    const leg = stageDeltas(doc, NOW).find(d => d.key === 'exit_to_close')!;
    expect(leg.missing).toContain('stale_after_upgrade');
  });

  it('measures door-to-notification from the DISPLAY receipt, never from the send', () => {
    const doc = visitDoc({
      visit: boardRow({
        started_at: ago(90), checked_in_at: ago(90), claimed_at: ago(60),
        ended_at: ago(20), completed_push_at: ago(18), status: 'closed',
      }),
      pushes: [pushRow({ created_at: ago(18), delivered_at: ago(15) })],
    });
    const deltas = stageDeltas(doc, NOW);
    expect(deltas.find(d => d.key === 'push_to_drawn')!.seconds).toBe(3 * 60);
    expect(deltas.find(d => d.key === 'door_to_notification')!.seconds).toBe(75 * 60);
  });

  it('refuses to claim a banner drew when only the SEND is stamped', () => {
    const doc = visitDoc({
      visit: boardRow({ started_at: ago(90), ended_at: ago(20), completed_push_at: ago(18), status: 'closed' }),
      pushes: [pushRow({ created_at: ago(18), delivered_at: null })],
    });
    const leg = stageDeltas(doc, NOW).find(d => d.key === 'door_to_notification')!;
    expect(leg.seconds).toBeNull();
    expect(leg.missing).toMatch(/not been proven to draw/);
  });

  it('gives an open visit a live clock instead of seven dashes', () => {
    const deltas = stageDeltas(visitDoc(), NOW);
    expect(deltas[0].key).toBe('elapsed');
    expect(deltas[0].seconds).toBe(90 * 60);
  });
});

describe('device header', () => {
  const device = {
    platform: 'android', app_version: '1.5.0', app_build: '19',
    ota_update_id: 'aaaaaaaa-1111', ota_channel: 'preview',
    token_updated_at: ago(5), newest_ota_on_channel: 'bbbbbbbb-2222',
  };

  it('flags a device running an older bundle than its own channel has published', () => {
    expect(isOtaBehind(device)).toBe(true);
    expect(isOtaBehind({ ...device, ota_update_id: 'bbbbbbbb-2222' })).toBe(false);
  });

  it('flags a device that lost its OTA and fell back to the embedded bundle', () => {
    expect(isOtaBehind({ ...device, ota_update_id: null })).toBe(true);
    expect(otaLabel({ ota_update_id: null })).toBe('embedded');
    expect(otaLabel(device)).toBe('aaaaaaaa');
  });

  it('does not cry stale when the channel has published nothing to compare against', () => {
    expect(isOtaBehind({ ...device, newest_ota_on_channel: null })).toBe(false);
    expect(isOtaBehind(null)).toBe(false);
  });
});

describe('last heard from', () => {
  it('names the source and never guesses why a device is quiet', () => {
    // An event gap cannot tell "app dead" from "user went nowhere".
    const label = lastHeardLabel(ago(12), 'region event', NOW);
    expect(label).toBe('12m 00s ago · region event');
    expect(label).not.toMatch(/dead|offline|crashed/i);
  });

  it('says so plainly when there is no footprint at all', () => {
    expect(lastHeardLabel(null, null, NOW)).toBe('never heard from');
  });
});

describe('checkinPathLabel', () => {
  it('names the foreground bucket instead of calling it unknown', () => {
    expect(checkinPathLabel(null)).toBe('Foreground / unlogged');
    expect(checkinPathLabel('foreground_or_unlogged')).toBe('Foreground / unlogged');
    expect(checkinPathLabel('enter_poll')).toBe('Native enter → poll');
    expect(checkinPathLabel('sweep')).toBe('Background sweep');
  });

  it('passes an unrecognised path through rather than hiding it', () => {
    expect(checkinPathLabel('some_new_path')).toBe('some_new_path');
  });
});

// ── History journeys ─────────────────────────────────────────────────────────

import {
  HISTORY_OUTCOMES,
  HISTORY_OUTCOME_KEYS,
  JourneyRow,
  TrendBucket,
  formatRate,
  historyPageInfo,
  journeyFindings,
  journeyStage,
  trendTotals,
} from '@/shared/liveops';

const journey = (over: Partial<JourneyRow> = {}): JourneyRow => ({
  visit_id: 'v1', user_id: 'u1', username: 'jamie', display_name: 'Jamie', email: 'j@powr.life',
  partner_id: 'p1', venue_name: 'POWR', platform: 'android', is_test: false,
  started_at: '2026-08-13T10:00:00Z', ended_at: '2026-08-13T11:00:00Z', close_reason: 'exit',
  claimed_at: '2026-08-13T10:30:00Z', upgraded_at: '2026-08-13T10:40:00Z',
  completed_push_at: '2026-08-13T11:01:00Z',
  native_enter_at: '2026-08-13T09:59:00Z', checkin_via: 'enter_poll',
  exit_detected_at: '2026-08-13T11:00:00Z',
  evidence_complete: true,
  nudge_count: 1, nudge_count_upgrade: 1, wakes_received: 2, proofs: 3, settled_stages: [],
  pushes_sent: 3, pushes_displayed: 3, pushes_receiptable: 3,
  session_duration_sec: 3600, points_earned: 60, total_count: 1,
  ...over,
});

describe('HISTORY_OUTCOMES', () => {
  // The SQL CASE in admin_liveops_history matches on these strings. Its `else
  // true` branch means a key that exists here but not there degrades to "no
  // filter" rather than erroring — silent, so the list is pinned.
  it('pins the key list mirrored in admin_liveops_history', () => {
    expect(HISTORY_OUTCOME_KEYS).toEqual([
      'all', 'full_chain', 'claimed', 'never_claimed', 'upgraded', 'claimed_not_upgraded',
      'no_os_enter', 'no_exit_detected', 'no_proof',
      'wake_starved', 'push_never_drew', 'no_completion_push',
      'server_settled', 'reaper_closed', 'evidence_expired',
    ]);
  });

  it('gives every filter a predicate, so nobody reads "never claimed" as "failed"', () => {
    for (const o of HISTORY_OUTCOMES) {
      expect(o.predicate.length).toBeGreaterThan(0);
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});

describe('journeyStage', () => {
  it('reads the stamps, not the close', () => {
    expect(journeyStage(journey())).toBe('upgraded');
    expect(journeyStage(journey({ upgraded_at: null }))).toBe('claimed');
    expect(journeyStage(journey({ upgraded_at: null, claimed_at: null }))).toBe('closed');
    expect(journeyStage(journey({ upgraded_at: null, claimed_at: null, ended_at: null }))).toBe('checked_in');
  });
});

describe('journeyFindings', () => {
  it('says nothing about a clean full-chain visit', () => {
    expect(journeyFindings(journey())).toEqual([]);
  });

  it('flags a receiptable push that never drew', () => {
    const f = journeyFindings(journey({ pushes_displayed: 0 }));
    expect(f.map(a => a.label)).toContain('PUSH NEVER DREW');
  });

  it('does NOT flag undrawn pushes when none were receiptable', () => {
    // iOS rides Expo, which never stamps delivered_at. Calling that "never drew"
    // would invent a bug on every iPhone in the fleet.
    const f = journeyFindings(journey({ pushes_displayed: 0, pushes_receiptable: 0 }));
    expect(f.map(a => a.label)).not.toContain('PUSH NEVER DREW');
  });

  it('flags a wake-starved device', () => {
    const f = journeyFindings(journey({ nudge_count: 4, nudge_count_upgrade: 5, wakes_received: 0 }));
    expect(f.map(a => a.label)).toContain('WAKE STARVED');
  });

  it('reports expired evidence INSTEAD of scoring detection against it', () => {
    const f = journeyFindings(journey({
      evidence_complete: false, native_enter_at: null, exit_detected_at: null,
    }));
    const labels = f.map(a => a.label);
    expect(labels).toContain('EVIDENCE EXPIRED');
    expect(labels).not.toContain('NO OS ENTER');
    expect(labels).not.toContain('NO EXIT DETECTED');
  });

  it('flags a missing OS enter only when the evidence survives', () => {
    const f = journeyFindings(journey({ native_enter_at: null, checkin_via: 'sweep' }));
    expect(f.map(a => a.label)).toContain('NO OS ENTER');
  });

  it('names the settle stages when the server banked the credit', () => {
    const f = journeyFindings(journey({ settled_stages: ['dwell', 'upgrade'] }));
    expect(f.map(a => a.label)).toContain('SERVER SETTLED · dwell, upgrade');
  });
});

describe('trendTotals', () => {
  const bucket = (over: Partial<TrendBucket> = {}): TrendBucket => ({
    bucket: '2026-08-13', visits: 10, evidence_complete: 10, os_enter_delivered: 7,
    claimed: 6, upgraded: 4, closed_by_reaper: 2, exit_detected: 5, server_settled: 1,
    nudges_sent: 20, wakes_received: 15, pushes_receiptable: 8, pushes_displayed: 6,
    points_earned: 300, ...over,
  });

  it('divides each metric by its OWN denominator', () => {
    const t = trendTotals([bucket()]);
    expect(t.osEnter.pct).toBeCloseTo(70);      // over evidence-complete, not visits
    expect(t.claim.pct).toBeCloseTo(60);        // over all visits
    expect(t.pushDisplay.pct).toBeCloseTo(75);  // over receiptable pushes only
    expect(t.wakeAnswer.pct).toBeCloseTo(75);
  });

  it('excludes evidence-expired visits from the OS-enter denominator', () => {
    // 10 visits, only 4 with surviving evidence, 4 of those saw the crossing.
    // The honest answer is 100%, not 40% — the other six cannot vote.
    const t = trendTotals([bucket({ visits: 10, evidence_complete: 4, os_enter_delivered: 4 })]);
    expect(t.osEnter.pct).toBeCloseTo(100);
    expect(t.osEnter.measurable).toBe(4);
  });

  it('returns null — never 0% — when nothing could be measured', () => {
    const t = trendTotals([bucket({ pushes_receiptable: 0, pushes_displayed: 0, evidence_complete: 0 })]);
    expect(t.pushDisplay.pct).toBeNull();
    expect(t.osEnter.pct).toBeNull();
  });

  it('sums across buckets', () => {
    const t = trendTotals([bucket(), bucket()]);
    expect(t.visits).toBe(20);
    expect(t.points).toBe(600);
  });
});

describe('formatRate', () => {
  it('renders an unmeasurable rate as an em-dash, never as 0%', () => {
    // The 08-12 board read "0 pushes proven drawn" when the truth was "no push
    // that day rode a transport capable of proving it". This is that guard.
    const d = formatRate({ numerator: 0, measurable: 0, pct: null }, 'no push rode a transport that can prove display');
    expect(d.text).toBe('—');
    expect(d.text).not.toContain('0%');
    expect(d.unmeasurable).toBe(true);
    expect(d.title).toMatch(/nothing measurable/i);
    expect(d.title).toMatch(/no push rode a transport/);
  });

  it('keeps the denominator visible next to every percentage', () => {
    const d = formatRate({ numerator: 6, measurable: 8, pct: 75 });
    expect(d.text).toBe('75%');
    expect(d.ratio).toBe('6/8');
    expect(d.unmeasurable).toBe(false);
    expect(d.title).toBe('6 of 8 measurable');
  });

  it('prints a REAL zero as 0%, because that one did happen', () => {
    const d = formatRate({ numerator: 0, measurable: 12, pct: 0 });
    expect(d.text).toBe('0%');
    expect(d.ratio).toBe('0/12');
    expect(d.unmeasurable).toBe(false);
  });
});

describe('historyPageInfo', () => {
  it('counts pages off total_count, not off the rows on screen', () => {
    const p = historyPageInfo(342, 50, 0);
    expect(p.page).toBe(1);
    expect(p.pages).toBe(7);
    expect(p.label).toBe('1–50 of 342');
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(true);
  });

  it('reports the last page honestly when it is short', () => {
    const p = historyPageInfo(342, 50, 300);
    expect(p.page).toBe(7);
    expect(p.from).toBe(301);
    expect(p.to).toBe(342);
    expect(p.hasNext).toBe(false);
    expect(p.hasPrev).toBe(true);
  });

  it('says nothing matched rather than showing "1–0 of 0"', () => {
    const p = historyPageInfo(0, 50, 0);
    expect(p.from).toBe(0);
    expect(p.pages).toBe(1);
    expect(p.hasNext).toBe(false);
    expect(p.label).toBe('No visits match these filters');
  });

  it('never offers a next page when one full page is all there is', () => {
    const p = historyPageInfo(50, 50, 0);
    expect(p.pages).toBe(1);
    expect(p.hasNext).toBe(false);
    expect(p.label).toBe('1–50 of 50');
  });
});

describe('partitionBoard — a hidden visit must never look like no visit', () => {
  // The 2026-08-14 report: a founder inside the POWR office, mid-session, saw
  // "Nobody is inside a partner geofence right now". Three visits were open and
  // every one of them was filtered — his own account, the second dev account,
  // and a real user who happened to be at the excluded venue.
  const live = () => [
    boardRow({ visit_id: 'mine',  is_test: true,  ended_at: null }),
    boardRow({ visit_id: 'other', is_test: true,  ended_at: null }),
    boardRow({ visit_id: 'real',  is_test: true,  ended_at: null }),
    boardRow({ visit_id: 'past',  is_test: false, ended_at: ago(30) }),
  ];

  it('counts what it hid, so the caller can never imply emptiness', () => {
    const p = partitionBoard(live(), false);
    expect(p.open).toHaveLength(0);
    expect(p.hiddenOpen).toBe(3);
    expect(p.hiddenTotal).toBe(3);
  });

  it('hides nothing when the filter is off', () => {
    const p = partitionBoard(live(), true);
    expect(p.open).toHaveLength(3);
    expect(p.hiddenTotal).toBe(0);
    expect(p.hiddenOpen).toBe(0);
  });

  it('never loses a row: shown + hidden always equals what came back', () => {
    for (const includeTest of [true, false]) {
      const rows = live();
      const p = partitionBoard(rows, includeTest);
      expect(p.shown.length + p.hiddenTotal).toBe(rows.length);
      expect(p.open.length + p.recent.length).toBe(p.shown.length);
    }
  });

  it('splits open from closed on ended_at, not on status', () => {
    const p = partitionBoard([
      boardRow({ visit_id: 'a', is_test: false, ended_at: null, status: 'abandoned' }),
      boardRow({ visit_id: 'b', is_test: false, ended_at: ago(5), status: 'open' }),
    ], false);
    expect(p.open.map(r => r.visit_id)).toEqual(['a']);
    expect(p.recent.map(r => r.visit_id)).toEqual(['b']);
  });

  it('survives a null payload rather than throwing on an empty board', () => {
    const p = partitionBoard(undefined as unknown as never[], false);
    expect(p.shown).toEqual([]);
    expect(p.hiddenTotal).toBe(0);
  });
});
