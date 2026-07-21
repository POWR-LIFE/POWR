-- =============================================================
-- admin_get_users() v3
-- The admin Users page was showing profiles.level, a dead column
-- that nothing ever writes (everyone sat at its default of 1).
-- The app derives level from LIFETIME EARNED points:
--   total_earned = positive ledger sum + PENDING vault deposits
-- (the exact formula get_my_points_summary reports, which the
-- vault_level_up_check trigger also levels on).
-- Return total_earned and drop the stale level column so no
-- consumer can reach for it again — the client maps earned →
-- level with the constants/levels.ts thresholds.
-- Return type changes, so the old function must be dropped first.
-- =============================================================

drop function if exists public.admin_get_users();

create or replace function public.admin_get_users()
returns table (
  id                  uuid,
  username            text,
  display_name        text,
  avatar_url          text,
  is_admin            boolean,
  is_pro              boolean,
  location_granted    boolean,
  created_at          timestamptz,
  email               text,
  connected_providers text[],
  activity_types      text[],
  session_count       bigint,
  last_active_at      timestamptz,
  total_points        bigint,
  total_earned        bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    select
      p.id,
      p.username,
      p.display_name,
      p.avatar_url,
      p.is_admin,
      p.is_pro,
      p.location_granted,
      p.created_at,
      u.email::text,
      coalesce(prov.providers, '{}'::text[]) as connected_providers,
      coalesce(act.types, '{}'::text[])      as activity_types,
      coalesce(act.session_count, 0)         as session_count,
      act.last_active_at,
      coalesce(pts.balance, 0)               as total_points,
      coalesce(pts.earned, 0) + coalesce(vlt.pending, 0) as total_earned
    from public.profiles p
    join auth.users u on u.id = p.id
    left join lateral (
      select array_agg(distinct prov_name) as providers
      from (
        select lower(tc.provider) as prov_name
        from public.terra_connections tc
        where tc.user_id = p.id and tc.deauthed_at is null
        union
        select hpc.key
        from jsonb_each(coalesce(p.health_provider_connections, '{}'::jsonb)) hpc
      ) s
    ) prov on true
    left join lateral (
      select
        array_agg(distinct a.type::text) as types,
        count(*)                         as session_count,
        max(a.started_at)                as last_active_at
      from public.activity_sessions a
      where a.user_id = p.id
    ) act on true
    left join lateral (
      select
        sum(pt.amount)::bigint                                as balance,
        sum(pt.amount) filter (where pt.amount > 0)::bigint   as earned
      from public.point_transactions pt
      where pt.user_id = p.id
    ) pts on true
    left join lateral (
      select sum(vd.amount)::bigint as pending
      from public.vault_deposits vd
      where vd.user_id = p.id and vd.released_at is null
    ) vlt on true
    order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_get_users() from public, anon;
grant execute on function public.admin_get_users() to authenticated;
