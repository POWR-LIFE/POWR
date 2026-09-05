-- Public, read-only aggregates for the marketing homepage's proof strip.
-- No per-user data leaves this function: seven counters, nothing keyed.
--
-- QA/showcase accounts (showcase-%@powr.life — the seeded screenshot rig for
-- the landing page) are excluded so the public numbers only count real
-- members. House SECURITY DEFINER pattern: pinned search_path, EXECUTE
-- revoked from PUBLIC by name, granted back to anon + authenticated only.

create or replace function public.landing_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with excluded as (
    select id from auth.users where email like 'showcase-%@powr.life'
  )
  select json_build_object(
    'partners',     (select count(*) from partners where active),
    'brands',       (select count(distinct lower(brand_name)) from rewards where active and brand_name is not null),
    'sessions_7d',  (select count(*) from activity_sessions s
                       where s.verification <> 'manual'
                         and s.created_at > now() - interval '7 days'
                         and s.user_id not in (select id from excluded)),
    'points_7d',    (select coalesce(sum(t.amount), 0) from point_transactions t
                       where t.amount > 0
                         and t.created_at > now() - interval '7 days'
                         and t.user_id not in (select id from excluded)),
    'sessions_all', (select count(*) from activity_sessions s
                       where s.verification <> 'manual'
                         and s.user_id not in (select id from excluded)),
    'points_all',   (select coalesce(sum(t.amount), 0) from point_transactions t
                       where t.amount > 0
                         and t.user_id not in (select id from excluded)),
    'redemptions',  (select count(*) from redemptions r
                       where r.status <> 'refunded'
                         and r.user_id not in (select id from excluded))
  );
$$;

revoke all on function public.landing_stats() from public;
grant execute on function public.landing_stats() to anon, authenticated;
