-- Re-engagement + redemption-receipt emails — plumbing only. Nothing here sends:
-- the trigger and the daily cron live in 20260924120100_..._go_live.sql.
--
-- 1. reengagement_email_log — dedupe for send-reengagement-email
-- 2. get_reengagement_candidates() — who is due which email today
-- 3. redemptions.receipt_emailed_at — dedupe claim for send-redemption-receipt

-- ── 1. Dedupe log ────────────────────────────────────────────────────────────
-- One row per (member, lapse, stage). A lapse is identified by its anchor: the
-- last activity (lapsed) or signup (never started). Coming back moves the
-- anchor, so the next lapse starts a fresh two-email cycle.

create table if not exists public.reengagement_email_log (
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  lapse_anchor timestamptz not null,
  stage        smallint    not null,
  variant      text        not null,
  sent_at      timestamptz not null default now(),
  primary key (user_id, lapse_anchor, stage)
);

alter table public.reengagement_email_log enable row level security;
-- No policies: service-role only.

-- ── 2. Candidates ────────────────────────────────────────────────────────────
-- lapsed:        active before; stage 1 at 7 days quiet, stage 2 at 21.
-- never_started: onboarded, nothing ever logged; stage 1 at 3 days, stage 2 at 14.
-- "Activity" = any tracked session or earned points (walking, wearable syncs),
-- never bonuses. Stages only move forward within a lapse (someone first seen at
-- day 30 gets stage 2 once, never a late stage 1), and nobody gets two
-- re-engagement emails within 7 days of each other.

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
           pr.display_name, pr.location_granted, pr.active_health_provider
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
    coalesce(d.location_granted, false),
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

revoke all on function public.get_reengagement_candidates() from public, anon, authenticated;
grant execute on function public.get_reengagement_candidates() to service_role;

-- ── 3. Receipt claim ─────────────────────────────────────────────────────────

alter table public.redemptions add column if not exists receipt_emailed_at timestamptz;
