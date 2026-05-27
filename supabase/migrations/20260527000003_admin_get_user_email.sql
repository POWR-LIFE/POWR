-- Returns the email for a single user — admin only.
create or replace function public.admin_get_user_email(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;
  select u.email::text into v_email
  from auth.users u
  where u.id = p_user_id;
  return v_email;
end;
$$;

revoke execute on function public.admin_get_user_email(uuid) from public;
grant execute on function public.admin_get_user_email(uuid) to authenticated;
