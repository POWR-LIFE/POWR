# Scaling plan — check-ins → points at volume

> Status: **Phase 1 done 2026-08-28 · Post-event fixes done 2026-09-05 · Phase 2 open · Phase 3 signal-driven** · Owner: Jamie · Last review: 2026-09-05
>
> The work order that came out of the 27 Aug review ("will the geofence → points
> chain hold for the event, today, and at hundreds of thousands of check-ins?").
> Each item says what it is, why it's in this order, what says it's time, and
> where it stands. Update the status column when something ships; don't reorder
> without a reason written next to it. The instrumentation that drives the
> triggers is `/admin/system-health` — see [system-health-scope.md](system-health-scope.md).

---

## 0. The verdict this plan is built on

Measured against prod on 27 Aug (80 members, Micro compute, 284 MB database):

| Question | Answer | Why |
| --- | --- | --- |
| **60 check-ins in an hour at ONE LDN (event night)** | Yes, comfortably | Every limit in the chain is per-member (one live visit, one gym session per UTC day, 3 claims/hour). Beacon cap is 200 due visits per stage per minute; serial push fan-out ≈10 s inside a 60 s tick; ~720 REST statements over the hour against a pool idling at 20/60 connections. Busiest minute in prod history: 2 visits. |
| **Today** | Healthy | 7-day read: 26 real visits, 10/10 claimed paid, zero proven-unpaid / 429s / cap overshoots / open >12 h / cron failures; relay 0/855; pg_net queue 0. |
| **Hundreds of thousands, on and off all day** | Not on this setup | Correctness holds (unique indexes, advisory locks, idempotent 409s). Capacity doesn't — the ceilings below, in the order they bind. Supabase itself is not the ceiling; our schema volume, RLS shape, one serial loop and trigger design are. |

### Ceilings, in the order they give

| # | Ceiling | Today | Roughly binds at |
| --- | --- | --- | --- |
| 1 | **Raw geofence telemetry.** `geofence_region_events` is client-inserted at ~85 rows / member / day, kept 90 days. | 47 k rows · 15 MB | ~3–5 k active members (850 k rows/day at 10 k; 76 M rows live) |
| 2 | **Compute tier + RLS per-row cost.** Micro: 2 shared vCPU, 60 connections, PostgREST pool ≈10. Advisors: 134 `auth_rls_initplan` + 237 `multiple_permissive_policies`, concentrated on the hot tables. Auth server pinned to 10 connections absolute. | 20/60 conns, CPU idle | ~5–10 k active |
| 3 | **Beacon cap + serial push loop** (W3). 200 due per stage per minute, ~12 k wakes/hour platform-wide. | max due/tick 1 · tick p95 0.07 s | ~2 k simultaneous visits |
| 4 | **Ledger triggers re-sum the member's whole ledger per insert** (W1). O(tenure), not O(users). | 38.6 ms lifetime mean · max 419 rows/member | ~2.5 k rows/member |
| 5 | **pg_net single worker, no receipts** (W4). | 855 / 6 h · 0 failed | signal-driven |

These are estimates from per-member rates, not load tests. The event night on 4 Sep is the first real one — read the signals on 5 Sep and correct this table.

---

## Phase 1 — before the event night (4 Sep) · **DONE 2026-08-28**

Small, reversible, nothing touches a member's balance.

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 1 | Nudge devices still on 1.5.0 to update (they lack the drive-by banner fix and are behind the OTA fence) | ✅ | Store = 1.5.1 both platforms; `latest_*_version` keys already 1.5.1 so the in-app banner nags 1.5.0 binaries. Broadcast scheduled 28 Aug 18:30 London, audience `below_version: 1.5.1` → 17 devices. |
| 2 | Vacuum `net._http_response` | ✅ | 99 MB for 846 rows → 1.2 MB. Database 284 → 188 MB. Was a third of the DB and seq-scanned on every System Health load. |
| 3 | Sample floor on `ledger.insert_mean_ms` | ✅ PR #430 | `Signal.minSample = 20`; an hour with fewer inserts is grey, not red. The Points-ledger row had been red on 1–4 inserts an hour. |
| 4 | Confirm ONE LDN pin, radius, dwell | ✅ | Pin 41 m from the OSM Boulevard node; venue radius 35 m; dwell 30 / upgrade 40. Two real claimed visits there 28 Aug. |
| 5 | Decide the "already visited a gym today" rule | ✅ decided: **normal rules apply** | Attendance is a separate per-event reward, never a score input. Shipped as PR #431 (`attendance_bonus_points`, paid at door mark or **Pay attendance**; score toggles for challenges / bonuses / adjustments). ⚠ FNL x POWR reward still **0** — set it in the editor before 4 Sep. |

After the night: read `beacon_ticks`, `relay.*`, the Live Ops journeys for 4 Sep, and correct §0.

---

## Post-event read — 5 Sep 2026 · **DONE**

What the System Health page flagged the morning after FNL x POWR, and what shipped
for it the same day. None of these were on the ceilings table; all five were
either a small bug or a signal reading its own blind spot.

| # | Flag on the page | What it actually was | Fix | Status |
| --- | --- | --- | --- | --- |
| A | Data integrity **disrupted** (28 Aug → 4 Sep) | `integrity.dup_earns` = 2: a `manual_log` earn from the health-import path plus a `health_sync` top-up on the same session, 0.3 s and 2.8 s apart. The 25 Aug race guard only compared health_sync against health_sync. 5 points, two members. | Guard widened to any client-sourced pair (`20260905120000`). Points stay, by rule. | ✅ live |
| B | Proven but unpaid, 1 (**act**) | The beacon's settle pass has no memory of a refusal. One post-event visit whose day's cap was already spent was retried **676 times over 11 h**, each try inserting and deleting an activity session. Suzi hit the same loop on 27 Aug (33×). | `settleIsTerminal` (409, 422) closes the visit as `settle_declined` on the first final answer. Pinned in `__tests__/settleOutcome.test.ts`. | ✅ beacon v48 |
| C | Daily-cap overshoot, 1 member-day | Not a race. upgrade-gym-tier counted `gym` only toward the cap where claim-points counts gym **and HIIT**, so a manual HIIT log was invisible to the upgrade: 20 + 10 + 15 = 45. | Same gym+HIIT set in both functions. Overflow banks to the Vault as designed. | ✅ upgrade-gym-tier v34 |
| D | Gym check-ins **degraded** | `claims.wall_p95_s` on ~11 claims a day is the slowest claim of the day: one 34 s claim made two days red. | `minSample: 20` on the signal; under it the day is grey and out of uptime, same rule as the ledger mean. | ✅ PR |
| E | Database orange most days | `db.dead_tuple_pct` on gym_visits (355 rows): Postgres' default trigger is 50 + 20 %, so the table sits at 20–27 % dead between vacuums. Nothing wrong. | Per-table autovacuum at ~5 % on gym_visits and activity_sessions (`20260905120100`). | ✅ live |
| — | ONE LDN radius | Still the 130 m event-night setting; it is what caught B's visit 80 m from the pin. | Reverted to 40 m. | ✅ |

Not done: the Points-ledger row is grey almost every hour because the ledger
averages six inserts an hour against a 20-insert floor. That is the floor working;
judging it over 24 h instead of 1 h is a candidate for Phase 2, not a fix.

## Phase 2 — September, after the event

Cheap, behaviour-neutral, all found on 27 Aug. In this order.

| # | Item | Trigger / timing | Status | What it is |
| --- | --- | --- | --- | --- |
| 6 | **W1 cutover** | `ledger.balance_drift` = 0 for a week (0/72 since 25 Aug → ~1 Sep) | ⬜ | Repoint `notify_reward_unlocks`, `vault_level_up_check`, the `user_balances` view and `spend_points` at `user_point_balances`. Kills the O(tenure) re-sum. ⚠ Two columns on purpose: reward-unlock wants net sum; level-up wants sum(amount>0)+unreleased vault. ⚠ `trg_a0` must keep sorting before the readers. Separate migration; rebuild + drift check after. |
| 7 | **RLS clean-up migration** | now | ⬜ | `(select auth.uid())` in place of `auth.uid()` (134 warnings) and consolidate the multiple permissive policies (237) on `point_transactions`, `gym_visits`, `gym_visit_events`, `geofence_region_events`, `activity_sessions`, `profiles`. Same access outcome; removes the per-row CPU multiplier before it matters. Verify with the advisor list before/after. |
| 8 | **Housekeeping** (same migration as 7 or its own) | now | ⬜ | Drop duplicate index `referrals_referred_once` (≡ `referrals_referred_id_key`). Index `gym_visits.claimed_session_id` (claim-points step 11c looks up by it). Switch the auth server to percentage-based connections (else a compute upgrade never reaches sign-in). Fix `cron_silent` reporting a snapshot-system-health failure the run table doesn't hold. |
| 9 | **Geofence telemetry diet** | now — needs a product call on how much per-visit history we keep | ⬜ | Ceiling #1. Options by effort: 30-day retention for rows of closed visits → client-side sampling of `sweep` / `wake_received` (7 k of this week's 11 k rows) → keep raw only while a visit is open, aggregate the rest. |

---

## Phase 3 — signal-driven, not date-driven

Do not start these on a calendar. Each has a line on `/admin/system-health`; start when it crosses.

| # | Item | Start when | Status | What it is |
| --- | --- | --- | --- | --- |
| 10 | **W3 beacon** | `beacon.due_per_tick` first reads above **50** | ⬜ | Paged loop over the 200 cap + concurrent push send, then shard by partner. Removing the cap alone makes wall-clock the new cap — shard, don't just unlimit. |
| 11 | **Compute upgrade** (Micro → Small/Medium; a restart) | `db.connections_pct` crosses **60 %** or `db.cache_hit_pct` sits under **99 %** | ⬜ | Do 7 + 8 first or you pay to run bad policies faster. Bring it forward deliberately only ahead of a launch expected to add thousands of active members at once. |
| 12 | **W4 pg_net replacement** | `relay.fail_pct` above **2 %** on a normal day, or `relay.queue_depth` above **50** | ⬜ | At-least-once queue with a push dedupe key (pushes are not idempotent today). Every bg claim relay and every DB-triggered push rides this. |

### Deliberately not on the list

- **W2 full claim-points plpgsql port** — a fifth copy of the scoring rules. The writes-only RPC variant waits for `claims.cap_overshoot_7d` to read above zero again.
- **Clean-up of the 106 historic excess points** — house rule: never claw back points that were our fault.

---

## How to keep this current

- When an item ships: status ✅, PR number, one line of what changed. Don't delete the row.
- When a signal trips: note the reading and date in the row before starting the work.
- After any load event (event night, a launch): re-measure §0 and say what moved.
- The judgements behind every trigger live in `shared/systemHealth.ts`, pinned by tests. A threshold moved there is reviewed; one moved in `system_config` isn't.
