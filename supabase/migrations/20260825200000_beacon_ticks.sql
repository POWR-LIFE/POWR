-- ---------------------------------------------------------------------------
-- beacon_ticks — one row per gym-visit-beacon stage per minute (System Health P2).
--
-- The beacon wakes at most DUE_LIMIT (200) visits per stage per tick. That is a
-- platform-wide ceiling: past it, visits wait for the next minute, and a busy
-- enough evening means some never wake before their exit. Until now the cap
-- made its own overflow INVISIBLE — a `.limit(200)` returns 200 rows whether
-- 200 or 2,000 were due. `due_count` is the head count taken before the limit,
-- and the System Health signal beacon.due_per_tick reads it, so the approach
-- to the ceiling is seen days before it binds instead of after.
--
-- Written by the beacon itself (service role), best-effort, never allowed to
-- fail a tick. Always written, even when nothing was due — "quiet" and
-- "beacon dead" must stay distinguishable.
-- ---------------------------------------------------------------------------

create table if not exists public.beacon_ticks (
  id           bigserial primary key,
  ran_at       timestamptz not null default now(),
  stage        text        not null check (stage in ('dwell', 'upgrade')),
  -- null = the count query itself failed; an honest gap, not zero
  due_count    integer,
  processed    integer     not null,
  sent         integer     not null default 0,
  failed       integer     not null default 0,
  duration_ms  integer     not null
);

create index if not exists beacon_ticks_ran_at_idx on public.beacon_ticks (ran_at desc);

-- Service role only (the beacon). Admins read it through system_health_facts.
alter table public.beacon_ticks enable row level security;
revoke all on table public.beacon_ticks from public, anon, authenticated;

-- 180 days: twice the other ops telemetry, because the whole point is a long
-- trend. ~2,880 rows/day.
select cron.schedule(
  'purge-beacon-ticks',
  '50 4 * * *',
  $cron$delete from public.beacon_ticks where ran_at < now() - interval '180 days'$cron$
);
