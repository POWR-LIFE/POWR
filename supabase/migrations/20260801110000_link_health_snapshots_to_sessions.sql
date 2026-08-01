-- Link workout health_snapshots back to the session they describe.
--
-- health_snapshots has carried hr_avg / hr_max / calories_active per workout
-- since April, but session_id was only ever set on the walking path
-- (lib/health/walkingSync.ts). Every workout and sleep snapshot — native AND
-- Terra — inserted with session_id NULL, so none of that data could be joined
-- back to the session it came from and no client surface could read it.
--
-- Write paths are fixed alongside this migration (hooks/useHealthSync.ts and
-- supabase/functions/terra-webhook/index.ts now pass the id they already hold),
-- so this only has to repair history.
--
-- Matching is deliberately conservative. recorded_at is the SYNC time, not the
-- workout time — a workout backfilled a week late records days after it
-- happened — so a time-window match is unreliable. (user_id, activity_type,
-- duration_sec) identifies the effort instead, bounded to snapshots recorded at
-- or after the session started. Round durations repeat (a 30m gym session is a
-- 30m gym session), so we require the match to be unique in BOTH directions and
-- skip anything ambiguous rather than guess: a wrong heart rate on a session is
-- worse than a missing one. In prod this links 286 sessions and leaves 80
-- ambiguous ones alone.

create index if not exists idx_health_snapshots_session
    on public.health_snapshots (session_id)
    where session_id is not null;

with candidate as (
    select s.id as session_id, h.id as snapshot_id
    from public.activity_sessions s
    join public.health_snapshots h
      on h.user_id = s.user_id
     and h.activity_type = s.type::text
     and h.duration_sec = s.duration_sec
     and h.recorded_at >= s.started_at
     and h.recorded_at < s.started_at + interval '14 days'
    where s.type::text not in ('walking', 'sleep')
      and h.session_id is null
      and h.duration_sec is not null
      and h.duration_sec > 0
),
unambiguous as (
    -- One session ↔ one snapshot. Either side having a second candidate means we
    -- can't tell which effort the vitals belong to, so neither gets linked.
    select c.session_id, c.snapshot_id
    from candidate c
    where (select count(*) from candidate a where a.session_id = c.session_id) = 1
      and (select count(*) from candidate b where b.snapshot_id = c.snapshot_id) = 1
)
update public.health_snapshots h
set session_id = u.session_id
from unambiguous u
where h.id = u.snapshot_id;
