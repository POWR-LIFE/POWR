-- Rewrite wearable sleep from TIME IN BED to TIME ASLEEP.
--
-- terra-webhook's handleSleep resolved a night as
-- `inBedSec ?? asleepSec ?? fallbackSec`, so `duration_in_bed_seconds` won
-- whenever the provider sent it — which Whoop always does. Every Terra-delivered
-- night was therefore stored as its whole bed window, lying-awake time included.
-- Reported live 2026-08-23: the Progress page showed 11h 6m against Whoop's own
-- 8h 48m for the night of 08-22, a night carrying 2h 20m of awake.
--
-- The stages are the repair. deep + REM + light is by definition asleep time,
-- they were parsed and stored correctly all along, and on that night they sum to
-- 8h 51m — Whoop's own figure to within three minutes. So nothing has to be
-- re-fetched from Terra: every affected row already contains its own answer.
--
-- Scope is deliberately narrow. All three stages must be present, or the sum
-- would silently understate a night that reported only two of them. And the row
-- must currently exceed the stage sum by more than a minute, which is what
-- confines this to the in-bed rows. That predicate was checked against prod
-- before this was written: of 256 candidate rows it selects 188 across 9 users
-- (140 whoop, 48 garmin) and passes over all 5 healthkit rows, because the
-- HealthKit reader drops the inBed and awake samples and sums stages — it was
-- already storing asleep time. The two ingest paths had simply been meaning
-- different things by one word. Average correction 28 min/night, largest 2h 17m.
--
-- started_at / ended_at are left alone on purpose. The window IS the bed window,
-- and it is what the bedtime and wake-time captions read; only the DURATION ever
-- claimed to be sleep. Afterwards duration_sec < ended_at - started_at on these
-- rows, which is the correct relationship and one the merge path already
-- tolerates (mergeWorkouts never assumes duration equals span).
--
-- POINTS ARE NOT CLAWED BACK — deliberate, Jamie's call 2026-08-23. On the 60-day
-- Whoop sample 33 of 94 nights had been paid one tier too high, 37 points in
-- total, and none underpaid. That was our arithmetic, not the users', so the
-- awards are grandfathered and point_transactions is untouched. Nights scored
-- from here on price the corrected hours.
--
-- Both statements below are independently idempotent: each compares the value it
-- is about to overwrite against the stage sum, so neither depends on the other
-- having run, and a re-run is a no-op.

-- The session row — this is the one the app reads. Every sleep surface derives
-- its headline from duration_sec: fetchSleepDayDetail's totalHours, the weekly
-- bars, the month heatmap.
update activity_sessions s
set duration_sec = f.asleep_sec
from (
    select s2.id as session_id,
           round((h.sleep_deep_h + h.sleep_rem_h + h.sleep_light_h) * 3600)::int as asleep_sec
    from activity_sessions s2
    join health_snapshots h
      on h.session_id = s2.id
     and h.activity_type = 'sleep'
    where s2.type = 'sleep'
      and s2.verification = 'wearable'
      and h.sleep_deep_h  is not null
      and h.sleep_rem_h   is not null
      and h.sleep_light_h is not null
) f
where s.id = f.session_id
  and f.asleep_sec > 0
  and s.duration_sec - f.asleep_sec > 60;

-- The snapshot's own copy of the same number. Keyed on sleep_duration_h rather
-- than on the session, so this stands or falls on its own.
update health_snapshots h
set duration_sec     = f.asleep_sec,
    sleep_duration_h = f.asleep_sec / 3600.0
from (
    select h2.id as snapshot_id,
           round((h2.sleep_deep_h + h2.sleep_rem_h + h2.sleep_light_h) * 3600)::int as asleep_sec
    from health_snapshots h2
    join activity_sessions s
      on s.id = h2.session_id
    where h2.activity_type = 'sleep'
      and s.type = 'sleep'
      and s.verification = 'wearable'
      and h2.sleep_deep_h  is not null
      and h2.sleep_rem_h   is not null
      and h2.sleep_light_h is not null
) f
where h.id = f.snapshot_id
  and f.asleep_sec > 0
  and h.sleep_duration_h * 3600 - f.asleep_sec > 60;
