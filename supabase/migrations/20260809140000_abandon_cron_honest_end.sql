-- The 12h abandon cron (jobid 8) fabricates a twelve-hour visit out of nothing.
--
-- Its third coalesce branch is `started_at + interval '12 hours'`, reached whenever
-- last_confirmed_at is null. Measured 2026-08-09: **34 rows** carry exactly that —
-- a row asserting a twelve-hour gym visit for a device that never once confirmed
-- it was there. This is the single largest source of fake durations left in
-- gym_visits, and it is what made ab3e0f38 read as a 12-hour session.
--
-- It also contradicts the doctrine the beacon's own stale-close reaper states:
-- "ended_at is the last PROVEN-inside moment, never now(): under-report a session
-- rather than inflate one."
--
-- ---------------------------------------------------------------------------
-- Why `started_at` is not the answer either
-- ---------------------------------------------------------------------------
-- last_confirmed_at is a BAD proxy for presence, because `log_gym_visit_tick`
-- never writes it — it only inserts a 'stream_tick' event. So a device that
-- streamed location fixes for hours leaves last_confirmed_at null and looks, to
-- this cron, exactly like a device that vanished at the door.
--
-- All 34 of those rows do have event evidence, averaging 276 minutes of it. Ending
-- them at started_at would under-report by four and a half hours — wrong in the
-- other direction rather than honest. So fall back to the last event that proves
-- the device was alive and believed itself inside, and only then to started_at.
--
-- A stream_tick is weaker evidence than confirm_gym_visit_v2's inside-confirm (the
-- coarse branch of evaluateLocationFix advances a session without ever running the
-- exit geometry, so a tick means "streaming and assuming inside", not "proven
-- inside"). It is used here only as a FALLBACK beneath last_confirmed_at, and only
-- to shorten a number that is otherwise invented outright.
--
-- ---------------------------------------------------------------------------
-- Both bounds are load-bearing
-- ---------------------------------------------------------------------------
-- least(..., started_at + 12h) — never lengthen. One row's ticks run to 34.9h,
-- the known late-write artifact where the client carried a day-old entryTimestamp
-- (see project session-duration work). Evidence that outruns the ceiling is
-- evidence the clock was wrong, not that the visit was longer.
--
-- greatest(started_at, ...) — never go negative. Caught in the dry run: one row's
-- newest event predates its own started_at by 1.3 minutes, because open_gym_visit
-- takes started_at from the DEVICE (`coalesce(p_started_at, now())`) while the
-- event row is stamped server-side. Device clock skew, and without this floor the
-- backfill would have written a visit that ended before it began.
--
-- Result on the 34: 29 shortened, 0 lengthened, mean 720 min → 181 min, range
-- clamped to [0, 720].
--
-- ---------------------------------------------------------------------------
-- ⚠ 20260803100000 §1 is deliberately NOT applied, and should not be
-- ---------------------------------------------------------------------------
-- That migration proposes guarding this cron with
-- `and coalesce(last_confirmed_at, started_at) < now() - interval '30 minutes'`
-- ("don't give up on someone demonstrably there"), citing 55-of-100 abandoned
-- visits. The premise is right and the remedy does not touch it. Measured against
-- all 66 abandoned rows, that guard would have spared **4** — three of them at the
-- POWR test venue in Meon Vale. The other 62 either never confirmed presence at
-- all (34) or had been silent for a mean of 10.3 hours (28). It is also built on
-- the same last_confirmed_at blind spot described above, so it cannot see the
-- stream-tick channel that would have justified sparing anyone.
--
-- §2 of that file reached prod separately via 20260807093330 / 20260807095229.
-- §1 is superseded by this migration; do not apply it on the strength of its own
-- header.

do $job$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'abandon-stale-gym-visits';
  if v_jobid is null then
    raise exception 'cron job abandon-stale-gym-visits not found';
  end if;

  perform cron.alter_job(
    v_jobid,
    command := $cron$
    update public.gym_visits v
       set status       = 'abandoned',
           close_reason = coalesce(v.close_reason, 'abandoned_12h'),
           ended_at     = greatest(v.started_at, least(
                            coalesce(
                              v.last_confirmed_at,
                              (select max(e.created_at) from public.gym_visit_events e
                                where e.visit_id = v.id
                                  and e.event in ('stream_tick','confirmed_inside','check_in')),
                              v.started_at),
                            v.started_at + interval '12 hours'))
     where v.ended_at is null
       and v.started_at < now() - interval '12 hours'
    $cron$
  );
end
$job$;

-- Backfill the rows the old third branch invented. Scoped by that branch's exact
-- signature — last_confirmed_at null AND ended_at landing on started_at + 12h to
-- the second — so it cannot touch a visit whose end was ever evidenced.
update public.gym_visits v
   set ended_at = greatest(v.started_at, least(
                    coalesce(
                      (select max(e.created_at) from public.gym_visit_events e
                        where e.visit_id = v.id
                          and e.event in ('stream_tick','confirmed_inside','check_in')),
                      v.started_at),
                    v.started_at + interval '12 hours'))
 where v.last_confirmed_at is null
   and v.ended_at is not null
   and abs(extract(epoch from (v.ended_at - (v.started_at + interval '12 hours')))) < 1;
