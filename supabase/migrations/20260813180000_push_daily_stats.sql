-- push_daily_stats — permanent notification health, all types (2026-08-13).
--
-- gym_visit_journeys answers "how is the gym chain working", but its push
-- columns only count sends inside a visit window. Everything else the product
-- sends — streak rescue, challenge invites, broadcasts, weekly summaries, daily
-- nudges — lives only in push_send_log, which purges at 90 days. So "are our
-- notifications working, and is it getting better?" was answerable for a
-- quarter and no longer.
--
-- Same shape as the journeys rollup: distil while the raw rows are alive, keep
-- the distillate forever. One row per day × type × transport × test-flag, which
-- at present is a few dozen rows a day and will stay trivial at any fleet size.
--
-- FACTS ONLY, and the transport split is the reason this table is honest.
-- delivered_at is stamped by the DEVICE, from the code path that actually drew
-- the banner — and ONLY the fcm_direct display path does it. An Expo-routed push
-- with a null delivered_at proves nothing at all. So `displayed` is meaningless
-- without `receiptable` beside it, and the two are kept as separate columns
-- rather than pre-divided. shared/liveops.ts owns the division and returns null
-- when the denominator is zero.

create table if not exists public.push_daily_stats (
  day         date    not null,
  type        text    not null,
  transport   text    not null default 'expo',  -- 'fcm_direct' | 'expo'; never null, so the PK works
  is_test     boolean not null default false,
  sent        integer not null default 0,
  accepted    integer not null default 0,
  rejected    integer not null default 0,
  skipped     integer not null default 0,
  -- Sends on a transport that CAN prove display. The denominator for any
  -- display-rate question; everything else is unmeasurable, not failed.
  receiptable integer not null default 0,
  displayed   integer not null default 0,
  redelivered integer not null default 0,
  rolled_up_at timestamptz not null default now(),
  primary key (day, type, transport, is_test)
);

comment on table public.push_daily_stats is
  'Permanent daily notification counts by type and transport. displayed is only interpretable against receiptable — see shared/liveops.ts.';

create index if not exists push_daily_stats_day_idx on public.push_daily_stats (day desc);

alter table public.push_daily_stats enable row level security;
revoke all on table public.push_daily_stats from public, anon, authenticated;


-- Recompute a window of days from the raw log. Idempotent; re-running is how a
-- day picks up display receipts that landed after the first pass (a banner can
-- be stamped minutes or, on a dozing handset, hours after the send).
create or replace function public.rollup_push_daily_stats(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from date := (now() - make_interval(days => greatest(p_days, 1)))::date;
  v_n    integer;
begin
  insert into public.push_daily_stats as s
    (day, type, transport, is_test, sent, accepted, rejected, skipped, receiptable, displayed, redelivered, rolled_up_at)
  select
    (l.created_at at time zone 'UTC')::date,
    l.type,
    coalesce(l.transport, 'expo'),
    (l.user_id = any(public.liveops_excluded_user_ids())),
    count(*),
    count(*) filter (where l.status in ('accepted', 'queued')),
    count(*) filter (where l.status in ('rejected', 'failed')),
    count(*) filter (where l.status = 'skipped'),
    count(*) filter (where l.transport = 'fcm_direct' and l.status = 'accepted'),
    count(*) filter (where l.delivered_at is not null),
    count(*) filter (where l.redelivered_at is not null),
    now()
  from public.push_send_log l
  where (l.created_at at time zone 'UTC')::date >= v_from
    -- fence_refresh is the wake loop talking to itself; it never draws anything
    -- and at bench cadence it would dominate every chart. Same exclusion as
    -- shared/liveops.ts isNoisePush.
    and l.type <> 'fence_refresh'
  group by 1, 2, 3, 4
  on conflict (day, type, transport, is_test) do update set
    sent         = excluded.sent,
    accepted     = excluded.accepted,
    rejected     = excluded.rejected,
    skipped      = excluded.skipped,
    receiptable  = excluded.receiptable,
    -- Receipts only ever arrive; a recount that sees fewer means the raw rows
    -- began aging out, not that a banner un-drew itself.
    displayed    = greatest(excluded.displayed, s.displayed),
    redelivered  = greatest(excluded.redelivered, s.redelivered),
    rolled_up_at = now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.rollup_push_daily_stats(integer) from public, anon, authenticated;

-- Backfill everything the log still holds.
select public.rollup_push_daily_stats(400);

-- Hourly, over a 3-day window: late display receipts and the beacon's
-- redelivery pass both land well after the send.
select cron.schedule(
  'rollup-push-daily-stats',
  '40 * * * *',
  $cron$select public.rollup_push_daily_stats(3)$cron$
);


create or replace function public.admin_liveops_push_stats(
  p_from         date    default (now() - interval '90 days')::date,
  p_to           date    default now()::date,
  p_include_test boolean default false
)
returns table (
  day date, type text, transport text,
  sent bigint, accepted bigint, rejected bigint, skipped bigint,
  receiptable bigint, displayed bigint, redelivered bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    select s.day, s.type, s.transport,
      sum(s.sent)::bigint, sum(s.accepted)::bigint, sum(s.rejected)::bigint,
      sum(s.skipped)::bigint, sum(s.receiptable)::bigint, sum(s.displayed)::bigint,
      sum(s.redelivered)::bigint
    from public.push_daily_stats s
    where s.day between p_from and p_to
      and (p_include_test or not s.is_test)
    group by s.day, s.type, s.transport
    order by s.day desc, sum(s.sent) desc;
end;
$function$;

revoke all on function public.admin_liveops_push_stats(date, date, boolean) from public, anon;
grant execute on function public.admin_liveops_push_stats(date, date, boolean) to authenticated;
