-- get_reengagement_candidates: report location from the live permission
-- snapshot, not the write-once onboarding flag.
--
-- profiles.location_granted is set once during onboarding and never revisited,
-- so a member who later revoked location would be told "gym visits count on
-- their own". profiles.location_permission is refreshed by the app; only
-- 'always' lets a visit log itself in the background. Pre-telemetry profiles
-- (location_permission null) fall back to the onboarding flag.

create or replace function public.get_reengagement_candidates()
returns table (
  user_id          uuid,
  email            text,
  display_name     text,
  variant          text,
  stage            int,
  lapse_anchor     timestamptz,
  days_away        int,
  balance          int,
  lifetime_earned  int,
  location_granted boolean,
  wearable         text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select u.id, u.email::text as email, u.created_at,
           pr.display_name, pr.active_health_provider,
           case
             when pr.location_permission is null then coalesce(pr.location_granted, false)
             else pr.location_permission = 'always'
           end as location_live
    from auth.users u
    join public.profiles pr on pr.id = u.id
    left join public.notification_preferences np on np.user_id = u.id
    where u.email is not null
      and u.raw_user_meta_data->>'onboarding_complete' = 'true'
      and coalesce(np.email_inactivity_nudge, true)
  ),
  act as (
    select b.*,
      greatest(
        (select max(s.started_at) from public.activity_sessions s where s.user_id = b.id),
        (select max(pt.created_at) from public.point_transactions pt
          where pt.user_id = b.id and pt.type = 'earn' and pt.amount > 0)
      ) as last_active
    from base b
  ),
  staged as (
    select a.*,
      case when a.last_active is null then 'never_started' else 'lapsed' end as variant,
      coalesce(a.last_active, a.created_at) as anchor,
      floor(extract(epoch from now() - coalesce(a.last_active, a.created_at)) / 86400)::int as days_away
    from act a
  ),
  due as (
    select s.*,
      case
        when s.variant = 'lapsed'        and s.days_away >= 21 then 2
        when s.variant = 'lapsed'        and s.days_away >= 7  then 1
        when s.variant = 'never_started' and s.days_away >= 14 then 2
        when s.variant = 'never_started' and s.days_away >= 3  then 1
      end as stage
    from staged s
  )
  select
    d.id,
    d.email,
    d.display_name,
    d.variant,
    d.stage,
    d.anchor,
    d.days_away,
    coalesce((select sum(pt.amount) from public.point_transactions pt where pt.user_id = d.id), 0)::int,
    coalesce((select sum(pt.amount) from public.point_transactions pt where pt.user_id = d.id and pt.amount > 0), 0)::int,
    d.location_live,
    coalesce(
      (select lower(tc.provider) from public.terra_connections tc
        where tc.user_id = d.id and tc.deauthed_at is null
        order by tc.last_event_at desc nulls last limit 1),
      d.active_health_provider
    )
  from due d
  where d.stage is not null
    and not exists (
      select 1 from public.reengagement_email_log l
      where l.user_id = d.id and l.lapse_anchor = d.anchor and l.stage >= d.stage
    )
    and not exists (
      select 1 from public.reengagement_email_log l
      where l.user_id = d.id and l.sent_at > now() - interval '7 days'
    );
$$;
