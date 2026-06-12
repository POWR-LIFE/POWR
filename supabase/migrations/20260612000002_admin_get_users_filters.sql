-- =============================================================
-- admin_get_users() v2
-- Adds aggregated columns so the admin Users page can filter by
-- connected device/provider, activity mix, points and recency:
--   connected_providers : active terra providers (lowercased) +
--                         native health providers from
--                         profiles.health_provider_connections
--   activity_types      : distinct session types the user has logged
--   session_count       : total activity sessions
--   last_active_at      : most recent session start
--   total_points        : current point balance (sum of transactions)
-- Return type changes, so the old function must be dropped first.
-- =============================================================

drop function if exists public.admin_get_users();

create or replace function public.admin_get_users()
returns table (
  id                  uuid,
  username            text,
  display_name        text,
  avatar_url          text,
  level               int,
  is_admin            boolean,
  is_pro              boolean,
  location_granted    boolean,
  created_at          timestamptz,
  email               text,
  connected_providers text[],
  activity_types      text[],
  session_count       bigint,
  last_active_at      timestamptz,
  total_points        bigint
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
      p.level,
      p.is_admin,
      p.is_pro,
      p.location_granted,
      p.created_at,
      u.email::text,
      coalesce(prov.providers, '{}'::text[]) as connected_providers,
      coalesce(act.types, '{}'::text[])      as activity_types,
      coalesce(act.session_count, 0)         as session_count,
      act.last_active_at,
      coalesce(pts.balance, 0)               as total_points
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
      select sum(pt.amount)::bigint as balance
      from public.point_transactions pt
      where pt.user_id = p.id
    ) pts on true
    order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_get_users() from public, anon;
grant execute on function public.admin_get_users() to authenticated;
