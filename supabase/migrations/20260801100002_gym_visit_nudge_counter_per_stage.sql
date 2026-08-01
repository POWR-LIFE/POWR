-- Per-stage nudge budgets, and an atomic increment.
--
-- TWO defects in one line of gym-visit-beacon/index.ts.
--
-- 1. `MAX_NUDGES = 4  // per stage` was never per stage — it is ONE column,
--    `gym_visits.nudge_count`, shared by both. The dwell filter is
--    `.lt('nudge_count', 4)` and the upgrade filter `.lt('nudge_count', 8)`, so the
--    upgrade stage actually receives `8 - (dwell nudges spent)` attempts: usually 7,
--    because the dwell nudge normally succeeds on attempt 1. Harmless in isolation
--    (more retries), but it made the budget unpredictable and the comment a lie —
--    and it is why a dwell stage that burns all 4 leaves only 4 for the upgrade.
--
-- 2. The increment is a read-modify-write off a stale SELECT:
--       .update({ nudge_count: (visit.nudge_count ?? 0) + 1 })
--    Two overlapping cron ticks both read N and both write N+1. Visit 67458ff7
--    logged two nudge_sent rows BOTH stamped `attempt 1`, and 5 dwell nudges
--    against a cap of 4.
--
-- Budgets are now explicit: dwell 4, upgrade 5. Total exposure 9 ≈ the old
-- effective 8, so this is not a material change in push volume against Apple's
-- ~2-3 background pushes/hour guidance. Deliberately NOT resetting nudge_count on
-- claim, which would have cut the upgrade stage from ~7 attempts to 4 on the leg
-- that is already the weakest.

alter table gym_visits add column if not exists nudge_count_upgrade int not null default 0;

comment on column gym_visits.nudge_count is
  'Wake attempts spent on the DWELL stage only. Budget lives in gym-visit-beacon.';
comment on column gym_visits.nudge_count_upgrade is
  'Wake attempts spent on the UPGRADE stage only. Separate budget from nudge_count.';

-- Backfill is intentionally a no-op: the only live rows are already past the dwell
-- stage, and a visit that has ended can never be nudged again. Starting the new
-- counter at 0 gives in-flight upgrade stages their full budget, which is the
-- forgiving direction.

-- ---------------------------------------------------------------------------
-- Atomic increment. `set x = x + 1` is evaluated by the database against the
-- CURRENT row under a row lock, so concurrent ticks serialise instead of both
-- writing the same value.
-- ---------------------------------------------------------------------------
create or replace function public.record_gym_visit_nudge(
  p_visit_id uuid,
  p_stage    text
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_attempt int;
begin
  if p_stage not in ('dwell','upgrade') then
    raise exception 'record_gym_visit_nudge: bad stage %', p_stage;
  end if;

  if p_stage = 'dwell' then
    update gym_visits
       set nudge_count   = nudge_count + 1,
           last_nudge_at = now()
     where id = p_visit_id
    returning nudge_count into v_attempt;
  else
    update gym_visits
       set nudge_count_upgrade = nudge_count_upgrade + 1,
           last_nudge_at       = now()
     where id = p_visit_id
    returning nudge_count_upgrade into v_attempt;
  end if;

  return coalesce(v_attempt, 0);
end;
$function$;

-- Server-side only: the beacon calls this with the service role. No user ever
-- needs it, and a user who could call it would be able to burn their own wake
-- budget. Mirrors the lockdown on the other beacon RPCs.
revoke all on function public.record_gym_visit_nudge(uuid, text) from public;
revoke all on function public.record_gym_visit_nudge(uuid, text) from anon;
revoke all on function public.record_gym_visit_nudge(uuid, text) from authenticated;
grant execute on function public.record_gym_visit_nudge(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Touch-only variant for the no-token path (see gym-visit-beacon D7). It must NOT
-- consume budget — nudges start at t+30, so four token-less minutes would burn the
-- whole dwell allowance before a token could ever appear — but it MUST move
-- last_nudge_at, or dueVisits re-selects the visit every single minute. Visit
-- 77736089 produced 722 nudge_failed rows that way, 28.5% of gym_visit_events.
-- ---------------------------------------------------------------------------
create or replace function public.touch_gym_visit_nudge(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update gym_visits set last_nudge_at = now() where id = p_visit_id;
end;
$function$;

revoke all on function public.touch_gym_visit_nudge(uuid) from public;
revoke all on function public.touch_gym_visit_nudge(uuid) from anon;
revoke all on function public.touch_gym_visit_nudge(uuid) from authenticated;
grant execute on function public.touch_gym_visit_nudge(uuid) to service_role;
