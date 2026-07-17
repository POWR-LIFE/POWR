-- Email-set overhaul (2026-07-17): level-up emails + richer brand digest +
-- unified cron auth.
--
-- 1. notification_preferences.email_level_up — per-user opt-out for the new
--    level-up email (no Settings UI yet; Mailgun unsubscribe also applies).
-- 2. level_up_email_log — one row per (user, level) ever emailed. The edge
--    function claims a row before sending, so threshold re-crossings (points
--    reversed then re-earned) can never double-send.
-- 3. notify_level_up_email() + trigger — when the Vault banks a level_up
--    deposit (vault_level_up_check), POST the event to send-level-up-email via
--    pg_net. Exception-safe: email plumbing must never break the points path.
-- 4. get_brand_weekly_report() — upgraded for the approved partner digest:
--    week-over-week redemptions, POWR spent, top rewards, low code stock and
--    pending submissions per brand. Platform audience stats are kept in the
--    return shape for a future email section. (The previous 2-arg version was
--    created outside the repo — migration 20260701000002 exists only in prod.)
-- 5. Cron auth: both Monday email jobs re-pointed at the x-resolve-token /
--    verify_resolve_token pattern (Vault: shared_resolve_token). The original
--    jobs carried tokens (x-weekly-token / x-brand-weekly-token) whose matching
--    function env vars were never provisioned, so BOTH Monday emails have been
--    silently 403ing since they shipped.

-- ── 1. Level-up email preference ─────────────────────────────────────────────

alter table public.notification_preferences
  add column if not exists email_level_up boolean not null default true;

-- ── 2. Dedupe log ────────────────────────────────────────────────────────────

create table if not exists public.level_up_email_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  level   int  not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, level)
);

alter table public.level_up_email_log enable row level security;
-- No policies: service-role only (it bypasses RLS); clients have no business here.

-- ── 3. Level-up trigger → send-level-up-email ────────────────────────────────

create or replace function public.notify_level_up_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_token text;
begin
  -- Level basis, matching vault_level_up_check(): positive ledger + unreleased
  -- vault. AFTER INSERT, so both sums already include this deposit.
  select coalesce((select sum(amount) from point_transactions
                    where user_id = new.user_id and amount > 0), 0)
       + coalesce((select sum(amount) from vault_deposits
                    where user_id = new.user_id and released_at is null), 0)
    into v_total;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'shared_resolve_token';

  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-level-up-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', coalesce(v_token, '')
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'level', new.level,
      'bonus', new.amount,
      'total_earned', v_total
    )
  );
  return new;
exception when others then
  -- Never let email plumbing break the points/vault path.
  return new;
end;
$$;

drop trigger if exists vault_level_up_email on public.vault_deposits;
create trigger vault_level_up_email
  after insert on public.vault_deposits
  for each row
  when (new.source = 'level_up' and new.level is not null)
  execute function public.notify_level_up_email();

-- ── 4. Brand weekly digest aggregates ────────────────────────────────────────

drop function if exists public.get_brand_weekly_report(timestamptz, timestamptz);

create or replace function public.get_brand_weekly_report(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz
)
returns table (
  brand_name text,
  portal_email text,
  logo_url text,
  redemptions int,
  prev_redemptions int,
  powr_spent bigint,
  live_rewards int,
  top_rewards jsonb,
  low_stock jsonb,
  pending_submissions int,
  platform_active_users int,
  platform_workouts int,
  platform_top_activity text
)
language sql
stable
security definer
set search_path = public
as $$
  with brand_redeem as (
    select
      lower(rw.brand_name) as brand_key,
      count(*) filter (where rd.redeemed_at >= p_since)::int as redemptions,
      count(*) filter (where rd.redeemed_at <  p_since)::int as prev_redemptions,
      coalesce(sum(rw.powr_cost) filter (where rd.redeemed_at >= p_since), 0)::bigint as powr_spent
    from public.redemptions rd
    join public.rewards rw on rw.id = rd.reward_id
    where rd.redeemed_at >= p_prev_since
      and rd.redeemed_at <  p_until
      and rw.brand_name is not null
      and rd.status <> 'refunded'
    group by lower(rw.brand_name)
  ),
  brand_top as (
    select brand_key,
           jsonb_agg(jsonb_build_object('title', title, 'count', cnt, 'value_label', value_label)
                     order by cnt desc) as top_rewards
    from (
      select
        lower(rw.brand_name) as brand_key,
        coalesce(rw.title, rw.brand_name) as title,
        rw.value_label,
        count(*)::int as cnt,
        row_number() over (partition by lower(rw.brand_name) order by count(*) desc) as rn
      from public.redemptions rd
      join public.rewards rw on rw.id = rd.reward_id
      where rd.redeemed_at >= p_since
        and rd.redeemed_at <  p_until
        and rw.brand_name is not null
        and rd.status <> 'refunded'
      group by lower(rw.brand_name), rw.id, rw.title, rw.brand_name, rw.value_label
    ) t
    where rn <= 3
    group by brand_key
  ),
  brand_low_stock as (
    -- Pool-code digital rewards running low on unassigned codes (matches the
    -- portal dashboard's low-stock warning).
    select
      lower(rw.brand_name) as brand_key,
      jsonb_agg(jsonb_build_object('title', rw.title, 'remaining', rc.remaining)
                order by rc.remaining asc) as low_stock
    from public.rewards rw
    join lateral (
      select count(*)::int as remaining
      from public.redemption_codes c
      where c.reward_id = rw.id and c.status = 'available'
    ) rc on true
    where rw.active = true
      and rw.brand_name is not null
      and rw.reward_kind = 'digital'
      and rw.integration_type = 'POOL'
      and nullif(trim(coalesce(rw.promo_code, '')), '') is null
      and rc.remaining < 10
    group by lower(rw.brand_name)
  ),
  brand_pending as (
    select lower(brand_name) as brand_key, count(*)::int as pending
    from public.reward_submissions
    where status = 'pending' and brand_name is not null
    group by lower(brand_name)
  ),
  brand_rewards as (
    select lower(rw.brand_name) as brand_key, count(*)::int as active
    from public.rewards rw
    where rw.active = true and rw.brand_name is not null
    group by lower(rw.brand_name)
  ),
  brand_logo as (
    select lower(rw.brand_name) as brand_key, rw.image_url as logo
    from (
      select brand_name, image_url,
             row_number() over (partition by lower(brand_name) order by created_at desc) as rn
      from public.rewards
      where brand_name is not null and image_url is not null
    ) rw
    where rw.rn = 1
  ),
  brand_users as (
    select rbu.brand_name, u.email
    from public.reward_brand_users rbu
    join auth.users u on u.id = rbu.user_id
    where u.email is not null
  ),
  plat_active as (
    select count(distinct pt.user_id)::int as active_users
    from public.point_transactions pt
    where pt.type in ('earn', 'adjustment')
      and pt.created_at >= p_since
      and pt.created_at <  p_until
  ),
  plat_workouts as (
    select count(*)::int as workouts
    from public.activity_sessions s
    where s.started_at >= p_since
      and s.started_at <  p_until
      and s.type not in ('sleep', 'walking')
      and coalesce(s.flagged, false) = false
  ),
  plat_top as (
    select s.type
    from public.activity_sessions s
    where s.started_at >= p_since
      and s.started_at <  p_until
      and s.type not in ('sleep', 'walking')
      and coalesce(s.flagged, false) = false
    group by s.type
    order by count(*) desc
    limit 1
  )
  select
    bu.brand_name,
    bu.email                              as portal_email,
    bl.logo                               as logo_url,
    coalesce(br.redemptions, 0)::int      as redemptions,
    coalesce(br.prev_redemptions, 0)::int as prev_redemptions,
    coalesce(br.powr_spent, 0)::bigint    as powr_spent,
    coalesce(bw.active, 0)::int           as live_rewards,
    bt.top_rewards,
    bls.low_stock,
    coalesce(bp.pending, 0)::int          as pending_submissions,
    pa.active_users                       as platform_active_users,
    pw.workouts                           as platform_workouts,
    pt2.type                              as platform_top_activity
  from brand_users bu
  left join brand_redeem    br  on br.brand_key  = lower(bu.brand_name)
  left join brand_top       bt  on bt.brand_key  = lower(bu.brand_name)
  left join brand_low_stock bls on bls.brand_key = lower(bu.brand_name)
  left join brand_pending   bp  on bp.brand_key  = lower(bu.brand_name)
  left join brand_rewards   bw  on bw.brand_key  = lower(bu.brand_name)
  left join brand_logo      bl  on bl.brand_key  = lower(bu.brand_name)
  cross join plat_active  pa
  cross join plat_workouts pw
  left join plat_top      pt2 on true
$$;

revoke all on function public.get_brand_weekly_report(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
-- Service role only (it bypasses the revokes); the edge function calls this.

-- ── 5. Cron auth: re-point both Monday email jobs at shared_resolve_token ────

do $job$
begin
  perform cron.unschedule('weekly-summary-email');
exception when others then
  null;
end
$job$;

select cron.schedule(
  'weekly-summary-email',
  '0 8 * * 1',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

do $job$
begin
  perform cron.unschedule('brand-weekly-report-email');
exception when others then
  null;
end
$job$;

select cron.schedule(
  'brand-weekly-report-email',
  '0 9 * * 1',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-brand-weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
