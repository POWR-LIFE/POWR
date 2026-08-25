# System Health — Scope

> Status: **P0 + P1 BUILT 2026-08-25** — migration applied to prod, page + dashboard tile wired, 38 jest tests; Vercel deploy pending. P2 (`beacon_ticks`) not started. · Owner: Jamie · Date: 2026-08-25
>
> An admin-portal page that keeps a running diagnosis of the platform's load-bearing
> paths — the check-in → points chain, the ledger, the beacon, the relay, the
> database — and tells us **when** each scaling workstream needs to start, with the
> evidence that says so. It answers one question: *"are we still safe, and if not,
> which thing do we fix next?"*

---

## 0. Decisions locked

| Decision | Choice |
| --- | --- |
| **Where it lives** | Admin portal, `landing-page/src/pages/admin/SystemHealth.jsx`, route `/admin/system-health`, under the **Ops** sidebar group next to Live Ops. Never the RN app. |
| **What it is** | A diagnosis, not a dashboard. Every signal is tied to a **named workstream** and an **act-when threshold**. No vanity metrics. |
| **Facts vs. judgements** | SQL returns **facts** (counts, timings, timestamps). `shared/systemHealth.ts` holds **every judgement** (green / watch / act, the threshold, the reason) as pure functions with jest coverage. Same rule as Live Ops, same reason: a rule that is wrong inside SQL is invisible. |
| **Rates** | RPCs return `{numerator, denominator}`; the TS computes the percentage and returns **null when nothing was measurable**. Rendering null as `0%` is the exact misread that made the 08-12 Live Ops board wrong on day one. |
| **History** | A permanent `system_health_snapshots` table, one row per signal per hour via cron. `pg_stat_statements` resets on every restart and compute change — without snapshots the "is it getting worse?" question is unanswerable past the last restart. |
| **Thresholds** | Constants in `shared/systemHealth.ts`, **pinned by tests**, each with a one-line `why`. Not `system_config` — a threshold moved silently in the DB is a diagnosis nobody reviewed. |
| **Alerts** | P1: a **"Needs attention"** tile on the admin dashboard (same shape as Flagged Sessions / Support Tickets). No Slack/email in this scope. |
| **Non-goals** | Not an APM. Does not replace Sentry (edge-function exceptions stay there — a link, not a re-implementation). No auto-remediation. Nothing user-facing. |

---

## 1. What this is measuring, and why

This page is the instrumentation for the scaling review of 2026-08-25. That review
found the platform correct under concurrency (the unique-index idempotency, the
atomic referral claim, the advisory-locked `spend_points` all hold at any scale)
but **capacity-bound** in four places, one of which degrades with every user's
tenure rather than with user count. Each of those is a workstream below; each has
a signal here whose job is to say when it's time.

| # | Workstream | What breaks | The signal that says "start now" |
| --- | --- | --- | --- |
| **W1** | Ledger balance materialisation | Two triggers on `point_transactions` (`notify_reward_unlocks`, `vault_level_up_check`) re-sum a user's **entire lifetime ledger** on every earn insert. Grows linearly with tenure. Already 33–52 ms mean per insert at 2,880 rows. | Insert cost trend + rows-per-user tail |
| **W2** | Writes-only claim RPC | claim-points is ~35 auto-commit REST calls with no transaction; an isolate dying mid-chain leaves a half-paid check-in. The daily-cap check is read-then-write with no backstop on the service path. | Partial-claim detector + claim latency |
| **W3** | Beacon sharding | `gym-visit-beacon` `.limit(200)` per stage per minute — a hard platform-wide ceiling of ~12k wakes/hour that compute cannot raise. Serial push fan-out. | Due-visits-per-tick vs. the cap |
| **W4** | Durable relay | Every background claim and every DB-triggered push rides pg_net: one worker, `batch_size = 200`, fire-and-forget, no receipt, no retry. | Queue depth + failure rate + oldest-pending age |
| **W5** | Compute tier | Micro: 2 shared vCPU, 1 GB, `max_connections = 60`. | Connection headroom, cache hit, CPU-proxy |

The review's recommendation, which this page is built to enforce: **W1 and W3 are
cheap and already degrading — do them soon. W2 only as the writes-only variant.
W4 and W5 wait until the signals say so.** Without the signals, "wait until" means
"wait until an outage".

---

## 2. Signals

Every signal is: **fact source → threshold → workstream → why**. Status is one of
`green` / `watch` / `act` / `unknown`. `unknown` is a real state (evidence not
collected, stats reset, cron dead) and must render as such — never as green.

### 2.1 Ledger (→ W1)

| Signal | Fact source | Watch | Act | Why |
| --- | --- | --- | --- | --- |
| Earn-insert mean time | `pg_stat_statements` — mean_exec_time of the PostgREST `INSERT INTO point_transactions` statements (trigger cost is inside this number) | > 75 ms | > 150 ms | Today 33–52 ms. Includes both lifetime sums + the rewards scan. The user-visible "points landed" latency lives here. |
| Ledger rows per user — p50 / p95 / max | `select count(*) … group by user_id` | p95 > 1,000 | max > 2,500 | The sum is O(rows). Max user today: 403. This is the *tenure* axis — it rises with zero user growth. |
| Ledger total rows | `count(*) point_transactions` | > 250k | > 1M | Seq-scan fallbacks in the triggers' planner choices get expensive here. |
| Balance drift *(post-W1 only)* | reconcile: materialised table vs. `sum()` per user | any ≠ 0 | > 5 users | Once W1 ships this is the invariant. Before W1 it reports `unknown`, not green. |

### 2.2 Claim chain (→ W2)

| Signal | Fact source | Watch | Act | Why |
| --- | --- | --- | --- | --- |
| Partial claims, 24 h | `gym_visits` with `claimed_session_id` set and an earn row, **but** the session's expected streak row / vault deposit missing, or `status = 'open'` > 10 min after `claimed_at` | ≥ 1 | ≥ 3 | The signature of the isolate dying between steps 10 and 11c. Zero today because volume is tiny; this is the first thing that becomes non-zero at scale. |
| Claim wall time p50 / p95 | `gym_visit_events`: `wake_received` → `claimed` delta (already in Live Ops aggregates — reuse, don't recompute) | p95 > 8 s | p95 > 20 s | PostgREST statement timeout and the client outbox's patience both bound this. |
| Claim outcome mix, 24 h | `gym_visit_events` `claimed` detail + `settle_*` events: direct / relay / settled / 409 / 422 / 429 | 429 ≥ 1 | 429 ≥ 3 | A 429 on a proven visit is the 08-13 Elliot class — the rate limit spent by a writer it doesn't govern. Must stay at zero. |
| Cap overshoot | users whose `earn + streak` for a gym day > 30 | ≥ 1 | ≥ 3 | The read-then-write cap race. Non-zero means two claims raced for one user. |

### 2.3 Beacon (→ W3)

| Signal | Fact source | Watch | Act | Why |
| --- | --- | --- | --- | --- |
| Due visits per tick — max / p95, 24 h | **new**: `beacon_ticks` row written by the beacon each run (`stage`, `due_count`, `sent`, `failed`, `duration_ms`) | max > 100 | max > 160 | The cap is 200. At 160 the next busy evening hits it and everyone past #200 never wakes. This table is the only way to see the ceiling *before* it binds — the current `.limit(200)` makes the overflow invisible. |
| Beacon tick duration | `beacon_ticks.duration_ms`, and `cron.job_run_details` for `gym-visit-beacon` | p95 > 30 s | max > 55 s | Runs every 60 s. Past 55 s ticks overlap and the settle/pursuit passes below the nudge pass starve. |
| Beacon failures | `cron.job_run_details.status <> 'succeeded'` last 24 h | ≥ 1 | ≥ 5 | A dead beacon = no background claims platform-wide. |
| Push fan-out failure rate | `beacon_ticks.failed / (sent + failed)` | > 10 % | > 30 % | The 08-12 read was 116 sent / 722 failed. Denominator shipped, pct null if zero attempts. |

### 2.4 Relay & push transport (→ W4)

| Signal | Fact source | Watch | Act | Why |
| --- | --- | --- | --- | --- |
| pg_net queue depth | `count(*) net.http_request_queue` | > 50 | > 200 | `batch_size = 200`. Above it the worker is behind by definition. Today: 0. |
| Oldest pending request | `min(created) net.http_request_queue` age | > 30 s | > 120 s | A relayed claim older than the client outbox's retry means the receipt-less path is now the slow path. |
| Relay failure rate (pg_net window) | `net._http_response`: `status_code >= 400 or timed_out or error_msg is not null` over total | > 2 % | > 10 % | These failures leave **no receipt anywhere else** — this table is the only witness. ⚠ `pg_net.ttl` is **6 h**, so the live read is a ~6 h window; the hourly snapshot is what makes it a day. |
| DB-triggered pushes, 24 h | count of `net.http_post` calls originating from triggers (`notify_reward_unlocks`, `notify_level_up_*`, `streak_rescue_progress`) via `net._http_response` URL match | > 5k | > 20k | Every one shares the single worker with the claim relay. |

### 2.5 Database capacity (→ W5)

| Signal | Fact source | Watch | Act | Why |
| --- | --- | --- | --- | --- |
| Connections used / max | `pg_stat_activity` count vs `max_connections` (60) | > 60 % | > 80 % | Micro's hard wall. Today 21/60. This is what turns into PostgREST 504s. |
| Cache hit ratio | `pg_stat_database` `blks_hit / (blks_hit + blks_read)` | < 99 % | < 95 % | `shared_buffers` = 224 MB. Below 99 % the working set no longer fits and every trigger sum goes to disk. |
| Longest running query | `pg_stat_activity` `max(now() - query_start)` for active non-idle | > 5 s | > 30 s | Lock pile-ups behind a slow trigger show up here first. |
| Dead tuples on hot tables | `pg_stat_user_tables.n_dead_tup` for `point_transactions`, `gym_visits`, `activity_sessions`, `gym_visit_events` | > 20 % of live | > 50 % | Autovacuum falling behind on Micro's CPU share. |
| DB size + growth / 7 d | `pg_database_size` snapshot deltas | — | — | Trend only; no threshold. Feeds the compute conversation. |

### 2.6 Integrity (the invariants — always `act` if non-zero)

These are not capacity. They are the "something is already wrong" checks, and
several are open items from the field audits that today have no standing detector.

| Signal | Fact source | Why |
| --- | --- | --- |
| Race-duplicate earns | earn rows on the same `session_id` with the **same amount, written < 5 s apart** — the 05-29 race signature. ⚠ *Not* "more than one earn per session": claim + upgrade is two rows by design, and health_sync tops a walking session up as steps grow (the cap trigger allows it). Day one of the page counted 260 of those and would have reported a non-incident. | The 05-29 race class. |
| Open visits > 12 h | `gym_visits.ended_at is null and started_at < now() - 12 h` | The reaper invariant. |
| Proven-but-unpaid visits, 24 h | `gym_visits` with `last_proven_at` set, dwell ≥ threshold, `claimed_session_id is null`, ended | The 08-13 class: presence proven, claim never landed, no receipt. |
| Beacon evidence gap | `gym_visit_journeys.evidence_complete = false` in the last 7 d | Raw evidence purged before rollup — the "publish a lie" guard. |
| PostgREST cap proximity | tables read unbounded by the client (`partners`, `rewards`, `activity_sessions` per user) — row counts vs. 1,000 | `partners` is already 7,835 and silently truncates; any new unbounded read is a latent bug. |
| Cron jobs silent | any `cron.job` with no `job_run_details` row in 2× its interval | A dead cron fails silently — there is no other alarm. |

---

## 3. Data model

### `system_health_snapshots` — permanent, hourly

```
id              bigserial pk
captured_at     timestamptz not null
signal          text not null          -- e.g. 'ledger.insert_mean_ms'
numerator       numeric                -- the fact
denominator     numeric                -- null when the signal is a scalar
detail          jsonb                  -- p50/p95/max, per-table breakdown, etc.
evidence_ok     boolean not null       -- false when the source was reset/unavailable
```

- RLS on, no policies, revoked from everyone — reachable only via the definer RPCs.
- Written by cron `snapshot-system-health` every hour (`0 * * * *`), plus on-demand
  from the page's "Snapshot now" button (same RPC).
- `evidence_ok = false` rows are kept and rendered as gaps, never interpolated.
- Retention: forever. It's a few hundred rows a day.

### `beacon_ticks` — permanent, one row per beacon stage per run

```
id            bigserial pk
ran_at        timestamptz not null
stage         text not null            -- 'dwell' | 'upgrade' | 'settle' | 'pursuit'
due_count     int not null             -- rows the query WOULD have returned (count before limit)
processed     int not null             -- rows actually handled
sent          int not null
failed        int not null
duration_ms   int not null
```

The one change to existing code in this scope: the beacon issues a `count: 'exact',
head: true` for each due query **before** applying `.limit(200)`, and writes this
row at the end of each stage. Without `due_count` the ceiling is unobservable — that
is the whole point of the table. Purge at 180 d (cron), mirroring the other ops
telemetry.

---

## 4. RPCs

All `security definer`, owned by `postgres` (required — `pg_stat_statements`,
`cron.job_run_details` and `net.*` are only readable as the owner), `set search_path
= public`, `is_admin()` gate as the first line, `revoke from public, anon`, `grant to
authenticated`. Run the definer lint before merge.

| RPC | Returns | Notes |
| --- | --- | --- |
| `admin_system_health_live()` | jsonb — every signal's **current** facts | One call, one round trip. Facts only. Each key carries `{numerator, denominator, detail, evidence_ok}`. |
| `admin_system_health_history(p_signal, p_from, p_to)` | rows from `system_health_snapshots` | For the trend sparklines. Numerator + denominator, never a pre-computed rate. |
| `admin_system_health_snapshot()` | void | Captures every signal into `system_health_snapshots`. Called by cron and the button. Idempotent within a minute (skips if a row < 60 s old exists). |
| `admin_beacon_ticks(p_from, p_to)` | rows | Feeds 2.3. |

Anything that could be reused from `admin_liveops_aggregates` (claim deltas, push
display rate) **is reused**, not duplicated. Two RPCs disagreeing on the claim p95
would be worse than having one.

---

## 5. `shared/systemHealth.ts`

```ts
export type Status = 'green' | 'watch' | 'act' | 'unknown';

export interface Threshold { watch: number; act: number; direction: 'above' | 'below'; why: string }
export interface Signal   { key: string; workstream: 'W1'|'W2'|'W3'|'W4'|'W5'|'integrity'; label: string; threshold: Threshold | null }

export const SIGNALS: Signal[]                               // the pinned list
export function judge(signal, fact): { status: Status; value: number | null; reason: string }
export function pct(numerator, denominator): number | null  // null when denominator is 0/null
export function workstreamStatus(signals): Record<Workstream, Status>   // worst-of
export function needsAttentionCount(signals): number        // feeds the dashboard tile
```

- `judge` returns `unknown` when `evidence_ok` is false or the fact is null. **Never
  green by default.**
- Jest pins: the `SIGNALS` list and every threshold value (a threshold edit must show
  up in a test diff), `pct(0, 0) === null`, `judge` on a reset `pg_stat_statements`
  → `unknown`, `workstreamStatus` is worst-of.
- The portal has no test runner — anything worth asserting lives here, not in the
  page.

---

## 6. Page

`/admin/system-health` — one file, portal convention.

1. **Header strip** — five workstream cards (W1–W5) + Integrity. Each shows worst-of
   status, the one signal driving it, and the act-when sentence. This row *is* the
   answer to "what do we work on next".
2. **Signals table** — grouped by section 2.x. Columns: signal · current value ·
   threshold · status · 7-day sparkline (from snapshots) · why. Sorted `act` →
   `watch` → `unknown` → `green`.
3. **Evidence notes** — when any `evidence_ok` is false, a banner stating which source
   and since when (e.g. *"pg_stat_statements reset 2026-08-27 03:10 — ledger timings
   unknown until ~24 h of traffic"*).
4. **Snapshot now** button; last-snapshot timestamp; link to Sentry for edge errors.
5. **Include test accounts** toggle, same exclusions as Live Ops.

Wired into `App.jsx` in the same four places as Live Ops: lucide icon, page import,
`PATH_LABELS`, `opsItems`, `<Route>`. Plus the dashboard tile in P1.

---

## 7. Phasing

| Phase | Delivers | Size |
| --- | --- | --- |
| **P0 — Live read** | `admin_system_health_live`, `shared/systemHealth.ts` + tests, the page with the header strip and signals table. No history, no cron. Sparklines absent. Sections 2.1, 2.2, 2.4, 2.5, 2.6. | ~1 day |
| **P1 — History + tile** | `system_health_snapshots`, `admin_system_health_snapshot`, hourly cron, `admin_system_health_history`, sparklines, evidence banner, dashboard "Needs attention" tile. | ~1 day |
| **P2 — Beacon ticks** | `beacon_ticks` table + the beacon change (count-before-limit + write per stage) + `admin_beacon_ticks` + section 2.3. **This one touches the beacon and needs a byte-diffed deploy and a field check.** | ~half day + a field-test window |
| **P3 — Post-W1 hooks** | Balance drift signal lights up once the materialised table exists. Placeholder renders `unknown` until then. | with W1 |

P0 and P1 touch nothing on any earning path. P2 is the only one that changes
production behaviour, and only by adding a count query and an insert.

---

## 8. Risks specific to this page

- **Definer functions reading `pg_stat_statements` / `net.*` / `cron.*`.** These
  need `postgres` ownership. That is a wider RLS bypass than the other admin RPCs;
  the `is_admin()` gate is the whole defence. Lint, and never grant to `anon`.
- **`pg_stat_statements` normalisation.** The statement text is PostgREST's
  generated CTE, which changes shape if PostgREST upgrades. Match on
  `query ilike '%INSERT INTO "public"."point_transactions"%'`, not on an exact
  string, and treat zero matches as `unknown`.
- **The beacon change (P2) is the only risk to a live path.** An extra `count`
  query per stage per minute is ~4 cheap queries/min. A failing `beacon_ticks`
  insert must be caught and logged, never allowed to fail the tick.
- **Green-washing.** The whole value of this page is that it says `act` when it
  should. The `unknown` state, the null-pct rule, and the pinned thresholds exist
  to stop it drifting into a page that is always green. If a threshold is raised
  to make something green, the `why` has to say why.

---

## 9. Open calls for Jamie

1. **Name** — "System Health" vs "Diagnosis". Scope assumes *System Health*, sidebar
   under Ops.
2. **Threshold numbers** — the values in section 2 are first-pass from the 08-25
   review. They should be revisited once P1 has a week of snapshots and we can see
   the real baselines.
3. **Retention on `beacon_ticks`** — 180 d assumed (2× the other ops telemetry,
   because the whole point is a long trend).
4. **Whether P2 waits for the next beacon deploy** anyway (there are other beacon
   changes pending) or ships on its own.
