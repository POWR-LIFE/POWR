-- Link sleep snapshots to their session, same conservative rule as workouts.
--
-- 20260801110000 deliberately skipped sleep because the workout tile row had
-- nothing to do with it. It does now: health_snapshots has carried
-- sleep_deep_h / sleep_rem_h / sleep_light_h since April on 926 rows — every
-- source fills them — and not one was reachable from its session, so the sleep
-- day sheet could only ever show a duration.
--
-- Matching is the same shape as the workout backfill and for the same reason:
-- recorded_at is the SYNC time, not the night, so (user_id, activity_type,
-- duration_sec) identifies the night instead, bounded to snapshots recorded at
-- or after it. Both the client (hooks/useHealthSync.ts) and Terra
-- (terra-webhook handleSleep) write duration_sec as round(hours * 3600) on BOTH
-- the session and the snapshot, so the two agree exactly.
--
-- Unique in both directions or skipped: two nights of identical length for one
-- user can't be told apart, and a wrong night's sleep stages are worse than
-- none. Sleep stages are NOT subject to the day-wide-source rule that gates
-- heart rate — a night's stages are per-session on every provider, including
-- HealthKit, which is why fetchSleepDayDetail has always trusted them.

with candidate as (
    select s.id as session_id, h.id as snapshot_id
    from public.activity_sessions s
    join public.health_snapshots h
      on h.user_id = s.user_id
     and h.activity_type = 'sleep'
     and h.duration_sec = s.duration_sec
     and h.recorded_at >= s.started_at
     and h.recorded_at < s.started_at + interval '14 days'
    where s.type::text = 'sleep'
      and h.session_id is null
      and h.duration_sec is not null
      and h.duration_sec > 0
),
unambiguous as (
    select c.session_id, c.snapshot_id
    from candidate c
    where (select count(*) from candidate a where a.session_id = c.session_id) = 1
      and (select count(*) from candidate b where b.snapshot_id = c.snapshot_id) = 1
)
update public.health_snapshots h
set session_id = u.session_id
from unambiguous u
where h.id = u.snapshot_id;
