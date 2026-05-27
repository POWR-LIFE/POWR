-- =============================================================
-- admin_get_users()
-- Returns profiles joined with auth.users.email for admin use.
-- Only callable by users with is_admin = true.
-- =============================================================

create or replace function public.admin_get_users()
returns table (
  id              uuid,
  username        text,
  display_name    text,
  avatar_url      text,
  level           int,
  is_admin        boolean,
  is_pro          boolean,
  location_granted boolean,
  created_at      timestamptz,
  email           text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Verify caller is an admin via admin_roles table (matches is_admin() policy function)
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
      u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

-- Revoke public execute, grant to authenticated users only
-- (the function itself enforces admin check)
revoke execute on function public.admin_get_users() from public;
grant execute on function public.admin_get_users() to authenticated;
