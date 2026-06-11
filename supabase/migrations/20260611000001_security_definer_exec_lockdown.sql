-- Lock down SECURITY DEFINER functions flagged by linter rules 0028/0029.

-- 1) Trigger functions: never called via the API. EXECUTE is only checked at
--    CREATE TRIGGER time, so existing triggers keep firing for all roles.
revoke execute on function public.enforce_point_award_cap() from public, anon, authenticated;
revoke execute on function public.handle_new_profile() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_user_notification_prefs() from public, anon, authenticated;
revoke execute on function public.sync_admin_role() from public, anon, authenticated;

-- 2) Admin RPCs: keep authenticated (landing-page admin dashboard calls them;
--    both self-gate via is_admin()), but anon has no business calling them.
revoke execute on function public.admin_get_user_email(uuid) from public, anon;
revoke execute on function public.admin_get_users() from public, anon;

-- 3) process_referral: requires a signed-in caller anyway (auth.uid()).
revoke execute on function public.process_referral(text) from public, anon;

-- 4) get_code_stats: add the missing admin gate. Called by the landing-page
--    admin promo-code manager as authenticated; previously any signed-in user
--    could enumerate redemption-code counts.
create or replace function public.get_code_stats(p_reward_id uuid)
returns table(status text, cnt bigint)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied: admin only';
  end if;
  return query
    select rc.status, count(*)::bigint as cnt
      from public.redemption_codes rc
     where rc.reward_id = p_reward_id
     group by rc.status;
end;
$$;

revoke execute on function public.get_code_stats(uuid) from public, anon;

-- public.is_admin() intentionally keeps EXECUTE for anon + authenticated:
-- it is referenced by RLS policies on partners/rewards/waitlist/profiles,
-- which are evaluated as the querying role. It leaks nothing (returns whether
-- the *caller* is an admin; always false for anon).
