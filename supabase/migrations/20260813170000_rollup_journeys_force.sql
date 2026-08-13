-- rollup_gym_visit_journeys(p_force) — the escape hatch a schema change needs.
--
-- Caught immediately after shipping evidence_complete (20260813160000). That
-- migration added the column and re-ran the batch rollup to populate it, and the
-- batch quietly did nothing: its WHERE clause only selects journeys that are
-- MISSING, STALE relative to their visit, recently closed, or still live. A
-- journey rolled up five minutes earlier is none of those, so all 165 existing
-- rows kept evidence_complete = false — and the history board reported that not
-- one visit in the fleet had usable evidence.
--
-- The skip logic is right for steady state (it is what keeps a per-10-minute
-- cron cheap) and wrong for exactly one case: the derivation itself changed, so
-- every row needs recomputing regardless of whether its visit moved. That is
-- what p_force is for. Any future change to rollup_gym_visit_journey's SELECT
-- list or derivations must be followed by:
--
--   select public.rollup_gym_visit_journeys(100000, true);
--
-- Recomputing is safe at any time: the function is a pure upsert over current
-- data, and its derived-from-purgeable columns are sticky (coalesce/greatest/or),
-- so a forced re-roll after the raw rows have aged out cannot erase what was
-- captured while they were alive.

create or replace function public.rollup_gym_visit_journeys(
  p_limit integer default 500,
  p_force boolean default false
)
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
    order by v.started_at desc
    limit greatest(p_limit, 1)
  loop
    perform public.rollup_gym_visit_journey(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.rollup_gym_visit_journeys(integer, boolean) from public, anon, authenticated;

-- The one-argument form the cron was scheduled against still resolves to the new
-- function via its default, but drop the old signature so two definitions cannot
-- drift apart.
drop function if exists public.rollup_gym_visit_journeys(integer);

select public.rollup_gym_visit_journeys(100000, true);
