# Post-upgrade proof stall — fix plan

Field run 2026-08-17 PM (visits `f2a43f1b` iOS / `9346e8d2` Android). Both platforms
completed the full unaided chain and closed themselves with `reason=exit`, and both
under-recorded because `close_gym_visit` clamps `ended_at` to a proof clock that had
stopped ticking: iOS 44.8 min recorded vs ~54.8 elapsed, Android 40.2 vs ~47.3.

Produced by a 13-agent review. **Every one of the eight first-draft fixes was refuted
by its adversarial pass**; what follows is what survived. Read §5 (changes NOT to make)
before touching anything — two of the three fixes originally requested are in it.

## Verification status — read this first

**2026-08-18: a second pass re-checked every claim below against the working tree,
the vendored native source and the live database. Read this section before §2.**

VERIFIED, and stronger than originally written:

- **Change 3's premise.** The acquire rung has reported a non-zero fix age **zero
  times in the history of the table** — 21 of 21 confirms since instrumentation
  said 0, across 8 visits and 2 users, while `stream_cache` (157 of 207) and
  `last_known` (63 of 99) report measured values. This is not one field row, it
  is the rung's entire behaviour. 13 of those 21 were accepted as proof.
- **Change 2's Android premise.** The check-in refusal is directly logged, not
  merely inferred: `geofence_region_events` 18:26:53.727,
  `stream_switch_deferred {"to":"dwell","from":"passive"}`, 51 ms after check-in.
  Three deferrals fired on that run.
- **Change 5's arithmetic**, and every line number it cites (`:404`, `:408`,
  `:421`, `:802-811`, `:816`) is exact.
- **The SQL of Change 1** now compiles and behaves: verified by creating the body
  against the real schema under a throwaway name, and by running the retrospective
  expression over 11 cases on the live database (below).

REFUTED — the plan was wrong and the fix has changed:

- **CHANGE 2 DOES NOT WORK AS WRITTEN, and its safety argument is false.**
  `expo-location`'s own JS-facing `startLocationUpdatesAsync` throws
  `ForegroundServiceStartNotAllowedException` at `LocationModule.kt:258-260`
  whenever the app is backgrounded AND the options carry a `foregroundService`
  block — *before* `registerTask` is reached. `DWELL_LOCATION_OPTIONS` carries
  one. So deleting the deferral converts a `stream_switch_deferred` row into a
  `stream_start_failed {restored:false}` row, leaves the stream on
  `distanceInterval: 50`, and recovers **zero minutes**. The chain the plan
  relied on (`maybeStartForegroundService` early-return, `registerTask`→
  `setOptions`, `setOptions`→fused `PendingIntent`) is each individually true but
  sits *downstream of a gate that never lets execution reach it*. The exception's
  message is byte-identical to the 2026-08-06 field log already quoted in
  `GeofenceContext.tsx`. **The claimed "+5.4 min on Android" does not follow.**
- **The Change 1 SQL as drafted would not compile** (`v_present` / `v_proven_at`
  undeclared), and had a client-triggerable `22015` interval overflow that would
  abort the whole confirm RPC — where today the same value merely evaluates a
  comparison false.
- **The Change 1 stamp had a lost-update race.** `v_visit` is read without
  `FOR UPDATE`, so a `greatest()` over that snapshot can regress the clock where
  today's `= now()` cannot. The max is now done against the row inside the UPDATE.
- **The Change 4 snippet would not compile** (`distanceM`/`fixTrusted`/`credits`
  are block-scoped or do not exist at the line that used them) and re-proposed a
  `VISIT_TICK_KEY` write that already exists.
- **Change 6's `proof_writer` cannot key off `proven` or off
  `created_at = last_proven_at`** — Change 1 breaks both. It keys off a new
  `stamped` flag, which is why 1 and 6 must be one migration.

FRAMING CORRECTION — the most important thing on this page:

**Change 1 addresses a minority of production loss.** Of 26 clamped exits in the
last 14 days (473 minutes lost in total), only **4** were anchored on
`last_proven_at`. **20 — all iOS — had `last_proven_at` NULL** and clamped to
`started_at`, and the eight largest of those (≈7 of the 473 minutes' hours) belong
to visits with **zero `confirmed_inside` rows**: the device never answered a wake
at all, so there is no confirm for a retrospective stamp to act on. If the next
14-day clamp count barely moves, that is the expected result, not a failed deploy.
Only Change 4 touches that population, and only where the stream ticks.
`clamp_anchor` in Change 6 is what separates the two populations from now on.

REPO/DB DRIFT FOUND AND FIXED: live migration `20260817145537_guard_client_session_window`
had no file in `supabase/migrations/`, so the repo could no longer rebuild the
database. Backfilled from `pg_get_functiondef` in this change.

STILL NOT VERIFIED: the "+5.4 min on Android" arithmetic (moot — see the Change 2
refutation), and whether an iOS batch flush would carry in-fence fixes.

### Change 1's arithmetic, verified on the live database

Eleven cases run against PG 17.6, all matching:

| case | result |
|---|---|
| 219 s stale, clock running → advances to `now−219s` | ✅ |
| 9999 s on a 60 s-old visit, never proved → **stays NULL** | ✅ |
| computed stamp earlier than existing clock → unchanged | ✅ |
| fresh 30 s fix, never proved → establishes at `now−30s` | ✅ |
| stale-but-inside, never proved → **stays NULL** | ✅ |
| hostile `1e18` age → clamped to 24 h, no `22015` | ✅ |
| negative age (clock skew) → clamped to 0 | ✅ |
| null age (pre-OTA client) → `now()`, exactly as today | ✅ |
| not inside geometry → never moves | ✅ |

**The NULL invariant is deliberately NOT relaxed**, and this is the one place the
implementation departs from the plan's draft. `gym-visit-beacon`'s SETTLE pass
gates on `if (!v.last_proven_at) continue;` and then bills `started_at → now()`,
**not** to the proof time — so letting a stale-but-inside fix turn NULL into a
value would hand full server-side credit to a visit that never proved anything.
The freshness gate therefore still owns *establishing* the clock; the
retrospective rule only ever *advances* one a fresh fix already started. On the
08-17 Android visit that costs nothing: its 19:11:06 stale fix computes 19:06:53,
earlier than the existing 19:07:04 anchor, so it correctly proves nothing new.

## Why APNs dropped the iOS pushes is UNPROVEN

18 silent sends (21 total) in 63.0 min against Apple's ~2-3/hr guidance (the
beacon's own comment at `gym-visit-beacon/index.ts:722` already flags this). Leading explanation,
no proof. Settling it needs an iOS sysdiagnose over `apsd`/`dasd` for the visit
window — not more code. **No change in this plan recovers a single iOS minute.**

---

# IMPLEMENTATION PLAN — post-upgrade proof stall (field run 2026-08-17 PM)

I pulled the actual rows for both visits before writing this. Several claims in the brief and in both investigation lenses are wrong, and one previously-unnamed defect is **currently inflating Android durations in production**. Read §1 and §5 before touching anything.

---

## 1. ROOT CAUSE

**Stated as fact. Three findings, all proven from `gym_visits`, `gym_visit_events` and `geofence_region_events` for visits `f2a43f1b-41b4-4b6d-b2fc-1c0cc47579a5` and `9346e8d2-0085-455e-9fd6-ea23638d57e3`.**

### 1a. THE STRUCTURAL CAUSE: `last_proven_at = now()` conflates *when we proved it* with *when you were there*

`confirm_gym_visit_v2` (`20260813140000_...sql:54-63`) stamps `last_proven_at = now()`, and to stop that being a lie it refuses any fix older than 120 s. So a fix is either banked at the wrong time or discarded entirely. There is no third option, and the whole incident is that third option's absence:

- A fix taken at 19:06:53 and delivered at 19:11:06 proves presence **at 19:06:53**. Today it proves nothing.
- `close_gym_visit` then clamps `ended_at` to `greatest(started_at, last_proven_at, claimed_at, upgraded_at)` (`20260813130000_...sql:33-40`), so every discarded fix becomes lost minutes.

iOS's entire loss is exactly `exit_time − last_proven_at`. Android's clamp landed on `upgraded_at` (19:07:05.261), 1.2 s later than `last_proven_at` — the anchor is `greatest(started_at, last_proven_at, claimed_at, upgraded_at)`, and which column wins matters. The 120 s cutoff is not protecting the guarantee; it is the reason the guarantee under-bills. The correct rule is **retrospective**: a fix that is trusted and geometrically inside advances the proof clock **to the fix's own timestamp**, never to `now()`. That is strictly safer than today (the anchor can only move earlier than `now()`) and it *dissolves* the 2026-08-10 regression — a 219 s-old precise fix would have stamped 19:06:xx, not 19:10:xx, and would have billed zero phantom minutes instead of four.

### 1b. ANDROID: the dwell stream never ran. Proven, caught in the act.

`geofence_region_events` 19:14:10.913, user `234d49f3`:

```
stream_switch_deferred  {"to":"approach","from":"passive"}
```

`from: "passive"` at 19:14 means the recorded stream mode was **still `passive` 47 minutes into a checked-in visit**. `setLocationStreamMode` (`GeofenceContext.tsx:1054-1058`) early-returns whenever `started && Android && AppState !== 'active'`, and check-in on a swiped-away app is always a background context — so the `setLocationStreamMode('dwell')` at `:3152` was refused and nothing ever retried it. The stream stayed on `LOCATION_UPDATE_OPTIONS` (`distanceInterval: 50`), which `LocationHelpers.kt:51` maps to `setMinUpdateDistanceMeters(50f)`: a stationary lifter gets nothing.

Corroborated independently by `stream_fix_age_s` in every confirm trace: 550 → 852 → 1150 → 1454 → 1750 → 1810 → 2051 → 2351 → 2412. One write at check-in (18:26:52), then **nothing for 44 minutes**, then the replayed pin at 19:10:04. This is the 07-03/07-11 starvation shape that `DWELL_LOCATION_OPTIONS` (`distanceInterval: 0`) exists to prevent, reappearing because the mode was never applied.

**And the guard is now guarding a hazard that no longer exists.** The stop→start it was written for was removed on 2026-08-17 (the `⚠ NO PRE-EMPTIVE STOP` comment at `:1059-1068`). `maybeStartForegroundService()` early-returns with a `Log.w` when not foregrounded (`LocationTaskConsumer.kt:163-167`) — it cannot throw the Android-12 refusal. `TaskService.registerTask` on an already-registered task takes `setOptions` (`TaskService.java:94-101`) → `stopLocationUpdates()` + `startLocationUpdates()` on the fused **PendingIntent** client (`LocationTaskConsumer.kt:70-79`), which needs no foreground service. Starting over the top from background is safe today; the early return is pure loss.

### 1c. iOS: a delivery failure, and the brief's 19:14 evidence is misdated

Zero `wake_received` rows between 19:08:03.549 and 19:19:02.533, on a device whose ticket transport demonstrably worked at 19:18:07.825. The presence pass did fire (`last_nudge_at 19:14:01.301`); APNs accepted and never delivered. The `acc_m 11 / distance_m 4 / fix_age_s 0 / elapsed_min 45` row the brief attributes to 19:14 is the **19:08:03.549** sweep — `elapsed_min 45` dates it exactly.

**Why APNs dropped 19:13:03, 19:14:01 and 19:23:04 is UNPROVEN.** Background-budget exhaustion (18 silent sends in 63.0 min against Apple's ~2-3/hr guidance, cited in `gym-visit-beacon/index.ts:722`) is the leading explanation and nothing in this repo or database can confirm it. **What would settle it:** an iOS sysdiagnose capturing `apsd`/`dasd` for 19:05-19:25 on the bench iPhone, or an instrumented re-run at 12/hr with the device console attached.

iOS also has **no working device-side fallback**, and this is proven rather than assumed: nine of its ten wakes found a stream-cache fix aged 0-1 s (the 19:04:05 upgrade wake read 59 s), but there is no `stream_tick` row after 19:03:06 and none during the walk-out. Deliveries are flushed *by* the arriving push; the `IOS_VISIT_LOCATION_OPTIONS` stream (`distanceInterval: 25`) produced nothing on its own for ten minutes. Under 1a, iOS's recovery depends on whether a deferred batch flushes at 19:18:07 with in-fence fixes in it — **unproven, and §4 does not claim it.**

---

## 2. ORDERED CHANGES

Ordered by user-visible impact. **Changes 1 and 2 must ship as one unit** — see §5.

---

### CHANGE 1 — Retrospective proof stamp (new migration)

**File:** new `supabase/migrations/20260818090000_proof_stamp_at_fix_time.sql`, replacing `confirm_gym_visit_v2`.

Split today's single `v_proven` into two:

```sql
-- Geometry + trust, ANY age. This proves presence AT THE FIX'S TIMESTAMP.
v_present := p_inside
         and coalesce((v_detail ->> 'fix_trusted')::boolean, false)
         and v_distance is not null
         and v_distance <= v_radius + coalesce(v_accuracy, 0);

-- Freshness. Gates CREDIT only (claim / upgrade), exactly as v_proven does today.
v_proven  := v_present
         and (v_fix_age_s is null or v_fix_age_s <= 120);

-- When the fix was actually taken. Never after now, never before the visit began,
-- and never backwards: greatest() means a stamp can only ever move the clock forward.
v_proven_at := greatest(
  coalesce(v_visit.last_proven_at, v_visit.started_at),
  least(now() - (coalesce(v_fix_age_s, 0) || ' seconds')::interval, now())
);
if v_proven_at < v_visit.started_at then v_proven_at := v_visit.started_at; end if;

update gym_visits
   set last_confirmed_at = case when p_inside   then now()        else last_confirmed_at end,
       last_proven_at    = case when v_present  then v_proven_at  else last_proven_at    end
 where id = p_visit_id and user_id = v_user and ended_at is null;
```

Keep the credit branch gated on `v_proven` (unchanged). Add `proven_at` alongside the existing `proven` key in the `gym_visit_events` detail so the field record stays readable.

**Reason.** This is the root cause from §1a. It is the only change that makes a stale-but-honest fix worth anything, and it is what makes Change 3 safe to ship. It cannot inflate: `last_proven_at` moves to a time ≤ `now()`, so the `close_gym_visit` clamp can never bill more than it does today, and `greatest()` makes it monotonic.

---

### CHANGE 2 — Android: stop deferring the dwell stream switch

> **⛔ DO NOT IMPLEMENT AS WRITTEN (refuted 2026-08-18).** The safety argument
> below is false. `expo-location`'s JS-facing `startLocationUpdatesAsync` throws
> `ForegroundServiceStartNotAllowedException` (`LocationModule.kt:258-260`)
> whenever the app is backgrounded and the options carry a `foregroundService`
> block — before `registerTask` is reached — and `DWELL_LOCATION_OPTIONS` carries
> one. Deleting the deferral turns `stream_switch_deferred` into
> `stream_start_failed {restored:false}` and recovers **zero minutes**. The catch
> restores with `LOCATION_UPDATE_OPTIONS`, which also carries a service, so that
> throws too. Two currently-green tests
> (`__tests__/geofence-arm-fix.test.ts:485` and `:514`) pin the deleted
> behaviour. See "Verification status" above, and the options below.
>
> **The only route that can actually apply dwell options from the background** is
> to strip `foregroundService` from the options on that path, since the throw is
> keyed on its presence. `killServiceOnDestroy: true` means a swiped-away app has
> no service anyway, so the block is doing nothing for the exact case that
> matters. But it is untested, it moves the gate to
> `ACCESS_BACKGROUND_LOCATION` (`LocationModule.kt:255-257` — fine for
> Always-granted users, a new failure mode for provisional ones), and
> `TaskService.java:106` persists the service-less options as the task's
> configuration. **This is a device-behaviour change that cannot be settled from
> the repo. It needs a decision and a field test, not a merge.**
>
> The `:3152` half of this change — capturing the discarded `StreamModeResult` so
> a refused switch is visible — carries no native risk and can ship on its own.


**File:** `context/GeofenceContext.tsx:1054-1058`. Delete:

```ts
if (started && Platform.OS === 'android' && AppState.currentState !== 'active') {
  logRegionEvent('stream', 'stream_switch_deferred', { from: current, to: mode });
  console.log(`[Geofence] Stream switch ${current} → ${mode} deferred — a background stop→start cannot restart.`);
  return { started, mode: current ?? 'passive' };
}
```

Replace with a log that records the attempt and falls through to the existing `startLocationUpdatesAsync` + catch-and-restore:

```ts
// ⚠ THE DEFERRAL IS GONE, AND ITS HAZARD WITH IT (2026-08-18). It guarded a
// stop→start that was removed on 08-17 (see below); expo's
// maybeStartForegroundService early-returns with a Log.w while backgrounded
// (LocationTaskConsumer.kt:163) so the Android-12 refusal cannot be thrown from
// here, and registerTask on a live task takes setOptions → stop/startLocationUpdates
// on the fused PendingIntent client, which needs no service. Field 2026-08-17:
// the deferral fired at check-in on both unaided chains and visit 9346e8d2 ran its
// whole 47 minutes on `passive` (distanceInterval 50) — stream_fix_age_s went
// 550→2412 and the 19:14:10 row still read from:"passive". The catch below is the
// safety net; a refused start restores the previous mode rather than deferring it.
if (started && Platform.OS === 'android' && AppState.currentState !== 'active') {
  logRegionEvent('stream', 'stream_switch_bg', { from: current, to: mode });
}
```

**Also `:3152`** — capture the discarded result so a failure is visible:

```ts
if (checkedInMode === 'dwell') {
  const res = await setLocationStreamMode('dwell');
  if (res.mode !== 'dwell') {
    logRegionEvent(regionId, 'stream_start_failed', { mode: 'dwell', at: 'check_in', got: res.mode });
  }
}
```

Add `'stream_switch_bg'` to the `logRegionEvent` event union at `:1115`.

**Reason.** This is the single change that recovers Android's minutes. With `distanceInterval: 0 / timeInterval: 60_000`, `LAST_STREAM_FIX_KEY` stays under 60 s so every wake's stream-cache fix credits; `evaluateLocationFix` runs every 60 s so the geometric exit fires within a minute of departure instead of two-plus; and it restores the only invocation path for `heartbeatVisitStream` and `selfPollIfWakeStarved`.

**Residual risk, flagged honestly:** `killServiceOnDestroy: true` means a swiped-away Android app has no foreground service, so Android's background-location throttle may still cap delivery below the 60 s contract. This change removes a **proven** blocker (the 50 m displacement filter); the 60 s cadence is **not** proven. Instrument it: the next field run must show `stream_tick` rows every ~5 min on Android, where this run had exactly one in 47 minutes.

---

### CHANGE 3 — Honest fix age on the acquire rung

**File:** `context/GeofenceContext.tsx:4355-4357`. Replace:

```ts
coords = fresh?.coords ?? null;
fixSource = fresh ? 'acquired' : 'timeout';
fixAgeMs = fresh ? 0 : null;
```

with:

```ts
coords = fresh?.coords ?? null;
fixSource = fresh ? 'acquired' : 'timeout';
// ⚠ MEASURED, NOT ASSERTED (2026-08-18). This was hardcoded 0 on the premise that
// "`acquired` is fresh by construction". It is not, and the 08-17 field run caught
// it live: on visit 9346e8d2 the 19:01:03 confirm reported fix_source 'acquired',
// acquire latency 6 ms and fix_age_ms 0, while the SAME wake's sweep measured the
// same fix at 130 s (stale_age_s 130, fix_ts 1786993132976) and rejected it. SEVEN
// of that visit's thirteen accepted proof stamps were a replay wearing a zero
// — the exact 2026-08-11 PM "cached fix wearing a new request" failure, on the one
// path with no age gate. A 6 ms acquisition is a cache read.
fixAgeMs = fresh && typeof fresh.timestamp === 'number' ? Math.max(0, Date.now() - fresh.timestamp) : null;
```

Do **not** reject on age here — under Change 1 an honest age becomes retrospective proof, and dropping the fix would also drop `inside`, which is what holds a real session open (the 07-03/07-11 lesson).

**Reason.** This is a live production defect that is currently **inflating** durations, not deflating them. It is not hygiene and it is not a prerequisite-in-name-only: without Change 1 it would collapse Android durations, and with Change 1 it makes the retrospective stamp truthful. The two are one change.

---

### CHANGE 4 — Make the stream heartbeat a proof writer

**File:** `context/GeofenceContext.tsx`, `heartbeatVisitStream` (`:4719-4795`).

Thread a real timestamp in: add an optional `fixTimestamp?: number` parameter to `evaluateLocationFix` (`:4797`) and pass it from the location task (`:5038` → `locations[locations.length - 1].timestamp`) and from the two other callers (`:1265`, `:1910` → `fix.timestamp`). Forward it to `heartbeatVisitStream`.

Then at `:4750-4760`, compute `fixAgeMs` and pass it to `fixCreditsPresence` (it is omitted today — the local credit floor has no freshness test at all, the defect closed server-side on 08-10). And when the fix credits, spend the round-trip the heartbeat is **already making** on a confirm instead of a tick:

```ts
const credits = fixCreditsPresence({ fixTrusted, distanceM, radiusM, accuracyM, fixAgeMs });
if (credits) await AsyncStorage.setItem(VISIT_TICK_KEY, String(now));
```

and replace the unconditional `logGymVisitTick` at `:4790`:

```ts
// ⚠ THIS USED TO BE "DELIBERATELY NOT confirmGymVisit" (lib/gymVisits.ts:349), on
// the reasoning that an indoor fix is usually too coarse to prove anything. That
// reasoning predates fixCreditsPresence, which is exactly the test for "is it",
// and the server re-derives v_present independently — a coarse fix simply fails,
// which is correct rather than harmful. Field 2026-08-17: both platforms froze
// their proof clocks while their streams held creditable fixes, because every
// writer of last_proven_at sat downstream of a DELIVERED push. This is the same
// single round-trip the tick was already making, at the same 5-minute throttle;
// it is now worth something. request_credit stays FALSE — a stream tick must
// never relay a claim.
if (credits) {
  const { confirmGymVisit } = await import('@/lib/gymVisits');
  await confirmGymVisit(active.visitId, true, {
    stage:       'stream',
    source:      'heartbeat',
    distance_m:  distanceM != null ? Math.round(distanceM) : null,
    accuracy_m:  coords.accuracy != null ? Math.round(coords.accuracy) : null,
    fix_trusted: fixTrusted,
    fix_age_s:   fixAgeMs != null ? Math.round(fixAgeMs / 1000) : null,
  }, false);
} else {
  const { logGymVisitTick } = await import('@/lib/gymVisits');
  await logGymVisitTick(active.visitId, { accuracy_m: ..., elapsed_min: ... });
}
```

Keep `logGymVisitTick` on the non-creditable branch — "the stream is alive but cannot prove" is exactly the liveness signal that branch exists to record.

**Reason.** This is the device-side proof writer the system has never had. It costs **zero extra round-trips** (the heartbeat already RPCs at `VISIT_TICK_INTERVAL_MS = 5 min`) and it makes the proof clock independent of push delivery wherever the stream ticks. It bounds the tail loss at 5 minutes instead of leaving it unbounded. On Android it is unlocked by Change 2; on iOS it fires whenever a batch flushes.

---

### CHANGE 5 — Beacon presence pass onto the proof clock

**File:** `supabase/functions/gym-visit-beacon/index.ts:404` and `:408`.

```ts
.select('id, user_id, started_at, last_proven_at')
...
.or(`last_proven_at.is.null,last_proven_at.lt.${silenceCut}`)
```

Add the reasoning inline, pointing at `:490-506` — the reaper directly below made exactly this correction on 2026-08-10 ("the clock now runs on `last_proven_at`, which has ONE writer and one meaning") and the pass that feeds it was left on the generous column.

**Reason.** An unprovable inside-confirm still writes `last_confirmed_at`, which deselects the visit from the only remaining proof-carrying wake source. Android's 19:11:06 unprovable confirm moved its next eligibility from 19:12:04 to 19:16:06 — past its 19:14:10 exit. `last_nudge_at` is frozen at 19:07:03 and `push_send_log` has no `gym_visit_check_presence` for that user at all.

Rate is unchanged: `touch_gym_visit_nudge` at `:421` runs unconditionally for every selected visit, so `PRESENCE_BACKOFF_MS` still caps this at one push per visit per 5 minutes either way.

---

### CHANGE 6 — Instrument the gap (ship with everything else)

In `close_gym_visit`, add to the `exit` event detail:
`proof_gap_s = extract(epoch from (requested_ended_at - last_proven_at))` and `proof_writer` (the `source`/`stage` of the last proven confirm).

**Reason.** `clamped:true` today does not say how much was lost or which writer last worked. Both numbers are the acceptance criteria for the next field run, and `proof_gap_s` is the metric that tells us whether the iOS problem moved at all.

---

## 3. ADVERSARIAL OBJECTIONS — SURVIVED AND NOT

| Change | Objection it survived | Objection it did NOT survive |
|---|---|---|
| **1** (retrospective stamp) | *"a precise-but-STALE fix stamped proof after departure" (08-10)* — survived by inversion: the 219 s fix now stamps its own 219-s-ago timestamp, billing zero phantom minutes instead of four. This is the regression's root fix, not a workaround. *"entry backdating awarded 33 phantom minutes" (08-09)* — survived: `greatest()` makes the stamp monotonic, `least(…, now())` caps it, and it is floored at `started_at`. | Nothing raised. **Untested new risk of my own:** a client that under-reports `fix_age_s` gains a later anchor. That risk is identical to today's — `v_proven` already trusts `detail.fix_age_s` — but it is now the *only* thing standing between a lying client and a later clamp, where before the 120 s cutoff also bounded it. Accepted; the geometry test still gates it. |
| **2** (dwell stream) | *"07-03/07-11: rejecting coarse fixes wholesale starved entire dwells"* — survived: this **restores** the stream that fixed that class. *"08-06 `stream_start_failed restored:FALSE`"* — survived: the stop→start it feared was removed on 08-17, `maybeStartForegroundService` cannot throw from background, and the catch-and-restore stays. | **Android background-location throttling.** With no foreground service after a swipe, the 60 s cadence is unproven. The 50 m filter removal is proven; the delivery rate is not. Must be measured, not assumed. |
| **3** (honest age) | The adversary's central charge — *"Edit 1 is a proof-laundering machine … `fixAgeMs = fresh ? 0 : null` is a hardcoded literal"* — is **correct**, and Change 3 is that charge, adopted. It also survives *"honest age = zero minutes recovered, so it is useless"*: the field row proves it is not useless, it is currently **inflating**. | Nothing. It is the adversary's own prerequisite. |
| **4** (heartbeat proof) | *"08-12 proof starvation, 4371 s → 2457 s (#345)"* — survived: it **adds** a writer rather than removing one. *"08-10 stamping the credit floor 9 min after the owner left"* — survived: the age and distance tests are unchanged, and the missing `fixAgeMs` on the local floor is fixed here. | **Volume.** `stage: 'stream'` confirms will roughly double `confirmed_inside` rows during a visit (they replace `stream_tick` rows one-for-one, so net row count is flat, but the RPC is heavier). Watch it. |
| **5** (presence on proof) | The adversary conceded this one directionally, and its single objection — *"it re-asks precisely the visits that fall through to the unmeasured acquire rung, increasing laundering"* — is removed by Change 3 shipping first. Rate bound survives via unconditional `touch_gym_visit_nudge`. | Nothing, **conditional on Changes 1+3 landing on devices first.** Deployed alone against pre-OTA clients it is net-harmful. See §7. |

---

## 4. WHAT THIS RUN WOULD HAVE RECORDED

**ANDROID** — visit `9346e8d2`, started 18:26:53.312, client exit 19:14:10.374, recorded **2412 s = 40.2 min**.

- Change 3 alone: **40.2 min, unchanged.** The seven phantom `age 0` acquires become honest 70-211 s, but the *honest* rungs already carried the visit — the 19:07:04 `last_known` fix (measured age 11 s) proved on its own merits. No loss on this run; on other runs this will correctly *reduce* inflated durations.
- Changes 1+3: **40.2 min, unchanged.** The 19:11:06 fix retro-stamps to 19:06:53, which is earlier than the existing 19:07:04 anchor. Correct — that fix genuinely proved nothing new.
- **Changes 1+2+3: ~45.6 min (+5.4).** A 60 s dwell stream keeps `stream_fix_age_s` under 60 throughout, so the 19:11:06 confirm proves; more importantly `evaluateLocationFix` runs every 60 s and fires the geometric exit at the real crossing. The 19:16:02 sweep measured `nearest_m 192` from a fix timestamped 19:14:07, so the true fence crossing was ~19:12-19:13 — a live stream both proves up to it and closes on it.
- **Plus Change 4: same ~45.6 min, but the residual is bounded at 5 min instead of unbounded.** Heartbeat proof would have landed at ~19:11:53.
- Change 5 adds nothing here — with the clock ticking, the visit is never quiet enough to select. That is correct; it is a rescue, not a driver.

**Honest ceiling:** the brief's "ACTUAL 47.3 min" is itself an overstatement. The client's exit fired 1-2 min after the real crossing. ~45.6 min is closer to the truth than 47.3, not further from it.

**iOS** — visit `f2a43f1b`, started 18:23:17.268, client exit 19:18:07.571, recorded **2686 s = 44.8 min**.

- Changes 1, 2, 3, 5: **44.8 min. Zero minutes recovered. Zero.** No code ran on that device between 19:08:03.549 and 19:18:07.825 — no `wake_received`, no `sweep`, no `stream_tick`, no confirm of any kind. Change 2 is Android-only. Change 5 moves the iOS presence nudge by exactly **zero seconds** — `last_confirmed_at` and `last_proven_at` are the same instant on this visit (19:08:03.574). The earlier "19:13:04" figure was wrong; do not use it as an acceptance number.
- Change 4: **44.8 min proven, up to ~52.7 min plausible.** *If* the 19:18:07 wake flushed a deferred CoreLocation batch containing in-fence fixes, Change 1 lets the newest of them retro-stamp `last_proven_at` to its own timestamp. There is no evidence in this run that such a batch exists — the absence of any `stream_tick` row after 19:03:06 is consistent with both "batch withheld until wake" and "stream delivered nothing at all". **Do not book this.**
- The brief's "ACTUAL 54.8 min" is also an overstatement: the 19:18:07 exit carries the POWR `region_id` and the 19:19:02 sweep put the device 251 m out, so this was the OS's ~120 m ring, not the 40 m fence. True departure was ~60-90 s earlier.

**Bottom line: Android +5.4 min proven. iOS +0 proven.** The iOS delivery failure is not fixed by this plan and this plan does not claim to fix it.

---

## 5. CHANGES NOT TO MAKE

1. **Do NOT reorder `runVisitCheck`'s fix ladder** (`GeofenceContext.tsx:4331`) so a 120-300 s stream-cache fix falls through to `acquire`. **Refuted by the field data itself.** On the 19:11:05 wake the sweep's acquisition *did* answer — with the same replayed 19:06:53 pin (`fix_src:'acquire_timeout', answered:'acquire_stale', stale_age_s:253, fix_ts:1786993613104`). `runVisitCheck`'s acquire would have received the identical fix. Recovers **zero minutes**, spends 3 s + 8 s against a ~10 s wake window (`:2125-2126`, `:4514-4516`), and re-enters the block the 2026-08-03 background-location freeze put last on purpose (`:4310-4326`). Change 2 makes the 120-300 s band stop occurring on Android anyway.

2. **Do NOT skip `fence_refresh` for users with an open visit** (`gym-visit-beacon/index.ts:816`). **Refuted.** `:769-777` re-reads the open-visit scan expressly to attach the id and `:802-811` builds `payloadFor(userId)` with `open_visit_id` for exactly the users this would skip; `backgroundNotificationTask.ts:298-307` passes it to the sweep and `GeofenceContext.tsx:1727` consumes it (`a.visitId ?? openVisitId`). That block's header (`:1694-1704`) calls it "the ONLY repeating post-upgrade path that measures presence" and cites the 08-12 clamp it was built for (4371 s → 2457 s). This deletes proof writer №3 to fix a proof stall. It also mutes fence-independent arrival detection for anyone with a forgotten-open visit — the `index.ts:636-648` mute-fence dead end, on the sweep `:806-807` credits with Android's only unaided check-ins.

3. **Do NOT clamp `ended_at` to `last_confirmed_at`.** Recovers every lost minute and bills unproven time. `last_confirmed_at` has four writers and the generous meaning; that is the whole reason the reaper moved off it on 08-10.

4. **Do NOT backdate the close from the exit fix.** Same objection. The exit fix proves you are *outside*.

5. **Do NOT widen `STREAM_FIX_MAX_AGE_MS`, narrow `MAX_CREDIT_FIX_AGE_MS`, or touch `MAX_FIX_ACCURACY_M`.** The first two only move the unprovable band; Change 1 dissolves it. Closing the `acc == 100` boundary on the credit side would delete Android's only proof writer outright — every one of this visit's stamps was `accuracy_m: 100` at `distance_m: 32`.

6. **Do NOT lower `IOS_VISIT_LOCATION_OPTIONS.distanceInterval` from 25.** Superficially attractive as "the iOS lever", and I nearly proposed it. The data kills it: iOS produced no `stream_tick` row even during the walk-out, when a 25 m filter must have been crossed three times. The stream is not being filtered, it is being *deferred by the OS* — a smaller filter changes nothing and costs JS wakeups.

7. **Do NOT lower `WAKE_STARVATION_MS`** (`:155`) or otherwise tune `selfPollIfWakeStarved`. It is invoked only from a location callback (`:4866`), so on this run it had no invocation path on either platform. Change 4 covers the same ground at the same call site with no new threshold.

8. **Do NOT bump the geofence radius.** Documented deliberate.

---

## 6. TESTS

**`__tests__/confirm_gym_visit_proof_stamp.test.ts`** (pgTAP or the existing SQL harness)
1. A confirm with `fix_age_s: 219`, inside geometry, trusted → `last_proven_at = now() - 219s ± 1s`, **not** `now()`. *Guards 2026-08-10: "a precise-but-STALE fix (219 s old) stamped proof 4 min after departure."*
2. A confirm with `fix_age_s: 9999` on a visit started 60 s ago → `last_proven_at = started_at`, never earlier. *Guards 2026-08-09 entry backdating (33 phantom minutes).*
3. A confirm whose computed `proven_at` precedes the existing `last_proven_at` → column unchanged. *Guards clock regression / out-of-order wake delivery.*
4. A confirm with `fix_age_s: 253` and `p_request_credit: true` → `triggered` is null, no claim, no upgrade. *Guards claiming off a stale fix.*
5. A confirm with `p_inside: true` but `distance_m > radius + accuracy` → neither column advances. *Guards 2026-08-09 fixCreditsPresence stamping at 67 m against a 20 m fence.*
6. A confirm on a visit with `ended_at` set → no proof column moves. *Guards the 08-13 no-stamp-after-close invariant.*

**`__tests__/geofence-stream-mode.test.ts`**
7. `setLocationStreamMode('dwell')` with `Platform.OS = 'android'`, `AppState = 'background'`, `started = true` → calls `startLocationUpdatesAsync` with `distanceInterval: 0`, returns `{started: true, mode: 'dwell'}`, emits no `stream_switch_deferred`. *Guards the 2026-08-17 field row `stream_switch_deferred {from:"passive",to:"approach"}` and the 07-03/07-11 stationary-dwell starvation.*
8. Same, but `startLocationUpdatesAsync` rejects on the first call → the previous mode is restored, `stream_start_failed` is logged with `restored: true`, and the return reports the *restored* mode. *Guards 2026-08-06 `stream_start_failed restored:FALSE` — never trade a live stream for none.*
9. `setActiveAndNotify` logs `stream_start_failed {at:'check_in'}` when the switch does not land on `'dwell'`. *Guards the discarded `StreamModeResult` at `:3152`.*

**`__tests__/geofence-fix-age.test.ts`**
10. `runVisitCheck` with an empty stream cache, no last-known, and an acquire mock returning a fix timestamped 130 s ago → the confirm detail carries `fix_age_s: 130`. *Guards the proven 2026-08-17 phantom proof: `runVisitCheck` reported `fix_age_ms: 0` on the same wake where the sweep measured `stale_age_s: 130`.*
11. Same with a fix timestamped 0 s ago → `fix_age_s: 0`. *Guards over-correction.*

**`__tests__/geofence-heartbeat-proof.test.ts`**
12. A creditable stream fix past the throttle → `confirmGymVisit(visitId, true, {...}, false)` is called with a measured `fix_age_s`, and `logGymVisitTick` is not. *Guards 2026-08-12 proof starvation, the #345 shrink 4371 s → 2457 s.*
13. A non-creditable stream fix (accuracy 300) → `logGymVisitTick` is called, `confirmGymVisit` is not, `VISIT_TICK_KEY` is not stamped. *Guards losing the stream-liveness signal, and guards the 08-10 phantom credit floor.*
14. `heartbeatVisitStream` passes a non-null `fixAgeMs` to `fixCreditsPresence`. *Guards the currently-live omission at `:4757` — the local credit floor has no freshness test at all.*
15. The `request_credit` argument is `false`. *Guards a stream tick relaying a claim.*

**`supabase/functions/_shared/__tests__/gym-visit-beacon-presence.test.ts`**
16. A visit with `last_confirmed_at = now()` and `last_proven_at = now() - 6min` **is** selected. *Guards the 08-17 Android amplifier: eligibility pushed 19:12:04 → 19:16:06, past a 19:14:10 exit.*
17. `touch_gym_visit_nudge` is called for every selected visit, including token-less ones. *Guards the 722-row re-select storm.*
18. A selected visit with `last_nudge_at = now() - 2min` is skipped. *Guards the 5-min backoff / wake-storm bound.*
19. `payloadFor(userId)` still returns `open_visit_id` for a user with an open visit, and `fence_refresh` is still sent to them. *Guards §5 item 2 — the change we explicitly refused.*

---

## 7. DEPLOY: OTA-SAFETY AND ORDER

| Change | Kind | Vehicle |
|---|---|---|
| 1 — retrospective proof stamp | SQL | **Migration** (`apply_migration` via Supabase MCP) |
| 6 — `proof_gap_s` on close | SQL | Same migration |
| 2 — dwell stream deferral | Pure TS | **OTA** |
| 3 — honest acquire age | Pure TS | **OTA** |
| 4 — heartbeat proof writer | Pure TS | **OTA** |
| 5 — presence on `last_proven_at` | Edge function | **`deploy_edge_function` gym-visit-beacon** |

**No native build required.** No new permission, no `app.json` change, no native module. `DWELL_LOCATION_OPTIONS` already exists and is already passed to `startLocationUpdatesAsync` at `:6104`; Change 2 only removes an early return in front of a call that already ships. `evaluateLocationFix`'s new optional parameter is additive.

### The order is load-bearing. Do not vary it.

**1. Migration first.** Change 3 makes clients report honest — i.e. *larger* — `fix_age_s`. Against today's `v_proven` (`<= 120` or nothing) those honest ages would be rejected outright and Android durations would collapse below where they are now. The migration must be live before a single client sends an honest age. It is backward compatible: pre-OTA clients keep sending `fix_age_s: 0` and `now() - 0 ≈ now()`, so their behaviour is unchanged.

**2. OTA second, both channels.** iOS is on `production` (1.5.0(17)), Android on `preview` (1.5.0(19)) — publish to both, and only the newest group is served, so verify each channel separately. Run `npm ci` before the publish (the fingerprint gotcha). Changes 2, 3 and 4 go together; **do not split 2 from 3** — Change 3 alone removes phantom proof that Change 2 has not yet replaced with real proof, and Android would record less than it does today for as long as the gap lasts.

**3. Beacon last, after confirming OTA reach.** Change 5 increases how often we nudge a device whose last answer was unprovable. Against a pre-OTA client that still hardcodes `fixAgeMs = 0`, every extra nudge is an extra opportunity to launder a replay into `last_proven_at`. Check reach before deploying; OTA-land visibility is a known blind spot here.

**Rollback:** each stage is independently revertible. The migration is a `create or replace function` — keep the prior body ready. The OTA rolls back by republishing the previous group. The beacon rolls back by redeploying the previous function.

### Acceptance criteria for the next field run

- Android: `stream_tick` rows every ~5 min for the whole visit. This run had **one** in 47 minutes. If this does not move, Change 2 was defeated by background-location throttling and the FGS question becomes the next investigation.
- Android: zero confirms with `fix_source: 'acquired'` and `fix_age_s: 0` paired against a same-second sweep reporting `stale_age_s > 0`.
- Both: `clamp_loss_s` on the exit row — `requested_ended_at − ended_at`, i.e. the time we failed to bill. Target under 300 s (the heartbeat interval). This run: iOS 604 s, Android 425 s.
- `proof_gap_s` (`requested_ended_at − last_proven_at`) is a DIFFERENT number, logged beside it: iOS 604 s, Android **426** s. It is NULL when the device never proved anything, which is itself the finding. `clamp_anchor` names the column the clamp landed on.
- iOS specifically: capture a sysdiagnose covering the visit. Nothing in this plan resolves the APNs drop, and `proof_gap_s` on iOS is the number that tells us whether it still exists.