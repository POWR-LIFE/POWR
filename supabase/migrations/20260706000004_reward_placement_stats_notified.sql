-- =============================================================
-- REWARD PLACEMENTS → surface the push leg ('notified') in stats
-- =============================================================
-- Zone-entry pushes log a 'notified' event (20260704000010) but
-- get_placement_stats didn't count them, so the push leg of the funnel was
-- invisible in both the admin panel and the partner portal. Adds a
-- `notified` column. (Return type changes, so drop + recreate.)
-- =============================================================

drop function if exists public.get_placement_stats(uuid[]);

create function public.get_placement_stats(p_placement_ids uuid[])
returns table (
  placement_id uuid,
  surfaced     bigint,
  presence     bigint,
  redeemed     bigint,
  notified     bigint,
  reach        bigint    -- distinct users who were ever surfaced
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.placement_id,
    count(*) filter (where e.event_type = 'surfaced'),
    count(*) filter (where e.event_type = 'presence_confirmed'),
    count(*) filter (where e.event_type = 'redeemed'),
    count(*) filter (where e.event_type = 'notified'),
    count(distinct e.user_id) filter (where e.event_type = 'surfaced')
  from public.reward_placement_events e
  join public.reward_placements pl on pl.id = e.placement_id
  where e.placement_id = any (p_placement_ids)
    and (
      exists (select 1 from public.admin_roles where user_id = auth.uid())
      or public.user_owns_reward_brand(pl.reward_id)
    )
  group by e.placement_id;
$$;

revoke all on function public.get_placement_stats(uuid[]) from public, anon;
grant execute on function public.get_placement_stats(uuid[]) to authenticated;
