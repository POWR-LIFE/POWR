-- =============================================================
-- REWARD PLACEMENTS → performance stats RPC (the feedback loop)
-- =============================================================
-- A placement is authored into a void today: nothing reads
-- reward_placement_events, so neither admin nor brand can see how it's doing.
-- Brands especially can't — the events RLS only exposes a user's OWN rows,
-- never aggregates for a placement they own.
--
-- This SECURITY DEFINER RPC returns the funnel counts (surfaced → present →
-- redeemed) + unique reach for a set of placements, but ONLY for placements
-- the caller may see: an admin, or the brand that owns the reward. Same RPC
-- powers the admin panel and the partner portal.
-- =============================================================

create or replace function public.get_placement_stats(p_placement_ids uuid[])
returns table (
  placement_id uuid,
  surfaced     bigint,
  presence     bigint,
  redeemed     bigint,
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
