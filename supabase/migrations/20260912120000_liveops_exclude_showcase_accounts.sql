-- The four showcase accounts (showcase-*@powr.life, ids a1a1a1a1-…) are seeded
-- data for the landing page's app screens, not members. `alexcarter` alone
-- carries 841 ledger rows and grows ~100 a month, so from 2026-09-05 it owned
-- every "largest read" reading on System Health (432 → 841 that day) and kept
-- Data integrity orange for good. Exclude them everywhere the test users are.
create or replace function public.liveops_excluded_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(u.id), '{}'::uuid[])
  from auth.users u
  where split_part(split_part(lower(u.email), '@', 1), '+', 1)
        in ('jamiemasonwright', 'bluegigsolutions')
     or lower(u.email) like 'showcase-%@powr.life'
$function$;

revoke all on function public.liveops_excluded_user_ids() from public, anon, authenticated;
