-- =============================================================
-- CREATOR PROGRAMME — ops
-- =============================================================
-- Click rollup on a schedule, fraud signals for the admin card,
-- and the superseded P0 ladder dropped. Jamie, 2026-08-25:
-- "implement all of the remaining work so it's good to go" —
-- with the master switch staying OFF.
-- =============================================================

-- ── 1. Click rollup on a schedule ────────────────────────────
-- rollup_creator_clicks() is is_admin()-gated, and pg_cron runs as
-- postgres with no auth.uid(), so it needs an internal twin with no
-- gate that only the owner can execute. Same body; the admin one
-- now delegates.
create or replace function public.rollup_creator_clicks_internal(p_days integer default 3)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_rows integer;
begin
  insert into public.creator_click_daily (creator_id, day, platform, campaign, clicks)
  select creator_id, created_at::date, coalesce(platform, 'other'),
         coalesce(campaign, ''), count(*)
    from public.creator_clicks
   where created_at >= (now() - make_interval(days => greatest(p_days, 1)))
   group by 1, 2, 3, 4
  on conflict (creator_id, day, platform, campaign)
    do update set clicks = excluded.clicks;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.rollup_creator_clicks_internal(integer) from public, anon, authenticated;

create or replace function public.rollup_creator_clicks(p_days integer default 3)
returns integer
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return public.rollup_creator_clicks_internal(p_days);
end;
$$;

-- Hourly at :25 — the portal reads creator_click_daily, never raw clicks.
select cron.unschedule(jobid) from cron.job where jobname = 'rollup-creator-clicks';
select cron.schedule('rollup-creator-clicks', '25 * * * *',
  'select public.rollup_creator_clicks_internal(3)');

-- ── 2. Fraud signals for the admin creator card ──────────────
-- Read-only, admin-gated. Four cheap questions:
--   shared_devices   — attributed signups that share a device with each
--                      other or with the creator's own account
--   ip_clusters      — click IP hashes seen many times in 30 days
--   fast_conversions — converted within 10 minutes of entering the code
--   signup_bursts    — most signups landing in any one hour
-- Device ids and IP hashes are truncated in the output: enough to see a
-- cluster, not enough to correlate anything.
create or replace function public.admin_creator_fraud_signals(p_creator_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_member uuid;
  v_shared jsonb;
  v_ips    jsonb;
  v_fast   integer;
  v_burst  integer;
  v_total  integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select member_user_id into v_member from public.creators where id = p_creator_id;
  select count(*) into v_total from public.referrals where creator_id = p_creator_id;

  with people as (
    select referred_id as user_id, 'signup' as role from public.referrals where creator_id = p_creator_id
    union all
    select v_member, 'creator' where v_member is not null
  ),
  devices as (
    select p.user_id, p.role, s.device_id
      from people p join public.activity_sessions s on s.user_id = p.user_id
     where s.device_id is not null
    union
    select p.user_id, p.role, d.device_id
      from people p join public.device_accounts d on d.user_id = p.user_id
  ),
  clusters as (
    select device_id, count(distinct user_id) as users,
           bool_or(role = 'creator') as includes_creator
      from devices group by device_id having count(distinct user_id) > 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'device', left(device_id, 8) || '…', 'users', users, 'includes_creator', includes_creator)
           order by users desc), '[]'::jsonb)
    into v_shared from clusters;

  select coalesce(jsonb_agg(jsonb_build_object('ip', left(ip_hash, 8) || '…', 'clicks', n) order by n desc), '[]'::jsonb)
    into v_ips
    from (select ip_hash, count(*) as n from public.creator_clicks
           where creator_id = p_creator_id and ip_hash is not null
             and created_at > now() - interval '30 days'
           group by ip_hash having count(*) >= 5
           order by n desc limit 5) t;

  select count(*) into v_fast from public.referrals
   where creator_id = p_creator_id and converted_at is not null
     and converted_at < created_at + interval '10 minutes';

  select coalesce(max(n), 0) into v_burst
    from (select count(*) as n from public.referrals
           where creator_id = p_creator_id
           group by date_trunc('hour', created_at)) t;

  return jsonb_build_object(
    'signups',          v_total,
    'shared_devices',   v_shared,
    'ip_clusters',      v_ips,
    'fast_conversions', v_fast,
    'signup_burst_max_per_hour', v_burst,
    'flags', (case when jsonb_array_length(v_shared) > 0 then 1 else 0 end)
           + (case when jsonb_array_length(v_ips) > 0 then 1 else 0 end)
           + (case when v_fast > 0 then 1 else 0 end)
           + (case when v_burst >= 5 then 1 else 0 end)
  );
end;
$$;
revoke all on function public.admin_creator_fraud_signals(uuid) from public, anon;
grant execute on function public.admin_creator_fraud_signals(uuid) to authenticated;

-- ── 3. Drop the superseded P0 ladder ─────────────────────────
-- Seeded into the Default programme's steps on 2026-08-25; nothing reads it.
drop table if exists public.creator_milestone_tiers;
