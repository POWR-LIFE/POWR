-- rollup_gym_visit_journeys: catch closes whose ended_at is BACKDATED.
--
-- Field 2026-08-25, visit 42c92efb: the abandon cron closed it at 19:20 with
-- ended_at = started_at (07:03 — nothing was ever proven, so nothing later is
-- honest). The rollup's staleness test compares rolled_up_at to the VALUE of
-- ended_at, and its "recently closed" window keys on that value too, so a close
-- stamped twelve hours in the past looked twelve hours old to both tests and the
-- journey was never re-rolled. Live Ops still showed the visit open a day later.
--
-- Every abandon-cron close is shaped like this (its ended_at is the last proving
-- EVENT, never now()), so this is a class, not a row. There is no updated_at on
-- gym_visits; the honest test is the one that cannot be fooled by a timestamp
-- value: the journey says open, the visit says closed. Terminal-status drift is
-- caught the same way (close_reason is only ever written once, at close).
create or replace function public.rollup_gym_visit_journeys(p_limit integer default 500, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id  uuid;
  v_n   integer := 0;
begin
  for v_id in
    select v.id
    from public.gym_visits v
    left join public.gym_visit_journeys j on j.visit_id = v.id
    where
      p_force
      or j.visit_id is null
      or j.rolled_up_at < greatest(
           v.started_at, v.created_at,
           coalesce(v.claimed_at, v.created_at),
           coalesce(v.upgraded_at, v.created_at),
           coalesce(v.ended_at, v.created_at),
           coalesce(v.last_confirmed_at, v.created_at),
           coalesce(v.completed_push_at, v.created_at))
      or (v.ended_at is not null and v.ended_at > now() - interval '2 hours')
      or v.ended_at is null
      -- A close the journey has not seen, regardless of what ended_at SAYS.
      or (j.ended_at is null and v.ended_at is not null)
      or (j.close_reason is distinct from v.close_reason)
    order by v.started_at desc
    limit greatest(p_limit, 1)
  loop
    perform public.rollup_gym_visit_journey(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
