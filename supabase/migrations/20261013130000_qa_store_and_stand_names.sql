-- QA store + in-store follow-ups (2026-10-13).
--
-- 1. POWR Store is the QA store. Accounts in qa_testers can see and claim its
--    INACTIVE rewards in the app, so every in-store path (claim, voucher,
--    stand, swipe, staff scan, till barcode, online + in store) can be tested
--    end to end without a test reward ever being visible to members. The
--    brand comes from system_config 'qa_brand_name' (default 'POWR Store').
--    Testers are added by an admin with SQL only; nothing in the app or the
--    portal can add one. Testers still spend real points on test claims.
--    redeem-reward pairs with this: it lets a tester claim an inactive
--    QA-store reward and refuses everyone else, as before.
--
-- 2. A stand from another shop now says which one: in_store_open_voucher's
--    STAND_OTHER_SHOP carries stand_shop ("POWR Store · POWR") and
--    reward_shop, so the app can say "That stand is for X. This reward is
--    for Y." instead of a bare "different shop".

create table if not exists public.qa_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.qa_testers enable row level security;
drop policy if exists "Testers read own row" on public.qa_testers;
create policy "Testers read own row" on public.qa_testers for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Admins read testers" on public.qa_testers;
create policy "Admins read testers" on public.qa_testers for select to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

insert into public.system_config (key, value, description)
values ('qa_brand_name', 'POWR Store',
        'QA store: accounts in qa_testers can see and claim this brand''s inactive rewards in the app.')
on conflict (key) do nothing;

create or replace function public.qa_brand_name()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select nullif(btrim(value), '') from public.system_config where key = 'qa_brand_name'), 'POWR Store') $$;

create or replace function public.is_qa_tester(p_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select p_user is not null and exists (select 1 from public.qa_testers where user_id = p_user) $$;

-- The QA store's inactive rewards, for a tester; empty for everyone else.
create or replace function public.qa_test_reward_ids()
returns uuid[] language sql stable security definer set search_path = public
as $$
  select case when public.is_qa_tester(auth.uid()) then coalesce(array(
    select r.id from public.rewards r
     where not r.active
       and r.reward_kind = 'digital'
       and lower(btrim(r.brand_name)) = lower(public.qa_brand_name())
     order by r.created_at), '{}') else '{}'::uuid[] end
$$;

drop policy if exists "QA testers read QA store rewards" on public.rewards;
create policy "QA testers read QA store rewards" on public.rewards for select to authenticated
  using (lower(btrim(brand_name)) = lower((select public.qa_brand_name())) and (select public.is_qa_tester((select auth.uid()))));

revoke all on function public.qa_brand_name() from public, anon;
revoke all on function public.is_qa_tester(uuid) from public, anon;
revoke all on function public.qa_test_reward_ids() from public, anon;
grant execute on function public.qa_brand_name() to authenticated;
grant execute on function public.is_qa_tester(uuid) to authenticated;
grant execute on function public.qa_test_reward_ids() to authenticated;

create or replace function public.in_store_open_voucher(
  p_redemption_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_stand_code text default null,
  p_stand_key text default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_red public.redemptions%rowtype;
  v_cfg public.reward_in_store%rowtype;
  v_brand text;
  v_existing uuid;
  v_site_id uuid;
  v_site_radius integer;
  v_stand public.reward_brand_sites%rowtype;
  v_near record;
  v_dist double precision;
  v_at_shop boolean := false;
  v_stand_ok boolean := false;
  v_step bigint := floor(extract(epoch from clock_timestamp()) / 30)::bigint;
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('error', 'NOT_SIGNED_IN'); end if;

  select * into v_red from public.redemptions where id = p_redemption_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v_red.status = 'used' then return jsonb_build_object('error', 'ALREADY_USED'); end if;
  if v_red.status <> 'active' then return jsonb_build_object('error', 'NOT_ACTIVE'); end if;
  if v_red.expires_at is not null and v_red.expires_at <= now() then return jsonb_build_object('error', 'EXPIRED'); end if;

  select * into v_cfg from public.reward_in_store where reward_id = v_red.reward_id;
  if not found or v_cfg.redeem_where = 'online' or v_cfg.check_method = 'till_barcode' then
    return jsonb_build_object('error', 'NOT_IN_STORE');
  end if;
  select btrim(brand_name) into v_brand from public.rewards where id = v_red.reward_id;
  if v_brand is null then return jsonb_build_object('error', 'NOT_IN_STORE'); end if;

  -- Re-entering the screen shows the same live voucher, same countdown.
  select id into v_existing from public.in_store_vouchers
   where redemption_id = p_redemption_id and status = 'open' and expires_at > now()
   order by opened_at desc limit 1;
  if v_existing is not null then
    return jsonb_build_object('voucher', public._in_store_voucher_payload(v_existing));
  end if;

  -- The shop's stand: printed (static key) or till tablet (rotating key).
  if nullif(btrim(p_stand_code), '') is not null then
    select * into v_stand from public.reward_brand_sites
     where stand_code = upper(btrim(p_stand_code)) and active;
    if not found then
      return jsonb_build_object('error', 'STAND_OTHER_SHOP', 'reward_shop', v_brand);
    end if;
    -- Name both shops, so "wrong stand" is obvious at the till.
    if lower(btrim(v_stand.brand_name)) <> lower(v_brand) then
      return jsonb_build_object('error', 'STAND_OTHER_SHOP',
        'stand_shop', btrim(v_stand.brand_name) || ' · ' || v_stand.name, 'reward_shop', v_brand);
    end if;
    if v_cfg.site_ids is not null and not (v_stand.id = any(v_cfg.site_ids)) then
      return jsonb_build_object('error', 'STAND_OTHER_SHOP',
        'stand_shop', btrim(v_stand.brand_name) || ' · ' || v_stand.name,
        'reward_shop', v_brand || ' (not at ' || v_stand.name || ')');
    end if;
    v_stand_ok := lower(coalesce(p_stand_key, '')) in (
      v_stand.stand_key,
      public.in_store_stand_key(v_stand.stand_secret, v_step),
      public.in_store_stand_key(v_stand.stand_secret, v_step - 1),
      public.in_store_stand_key(v_stand.stand_secret, v_step + 1));
    if not v_stand_ok then return jsonb_build_object('error', 'STAND_INVALID'); end if;
    v_site_id := v_stand.id;
    v_at_shop := true;
  elsif v_cfg.requires_stand then
    return jsonb_build_object('error', 'STAND_REQUIRED');
  end if;

  -- Location: recorded for reports, never a blocker. GPS indoors is too
  -- unreliable to refuse a member standing at the till.
  if p_lat is not null and p_lng is not null then
    select b.id, b.radius_m,
           111320.0 * sqrt(power(b.lat - p_lat, 2) + power((b.lng - p_lng) * cos(radians(p_lat)), 2)) as dist
      into v_near
      from public.reward_brand_sites b
     where b.active
       and lower(btrim(b.brand_name)) = lower(v_brand)
       and (v_cfg.site_ids is null or b.id = any(v_cfg.site_ids))
     order by 3 asc
     limit 1;
    if v_near.id is not null then
      v_dist := v_near.dist;
      if v_dist <= v_near.radius_m + least(greatest(coalesce(p_accuracy_m, 0), 0), 100) then
        v_at_shop := true;
      end if;
      if v_site_id is null and v_dist <= 1000 then v_site_id := v_near.id; end if;
    end if;
  end if;

  insert into public.in_store_vouchers (
    redemption_id, user_id, reward_id, brand_name, site_id, secret, expires_at,
    open_lat, open_lng, open_accuracy_m, open_distance_m, stand_scanned, at_shop)
  values (
    v_red.id, v_uid, v_red.reward_id, v_brand, v_site_id,
    encode(extensions.gen_random_bytes(16), 'hex'),
    now() + make_interval(mins => v_cfg.window_minutes),
    p_lat, p_lng, p_accuracy_m, case when v_dist is null then null else round(v_dist)::int end,
    v_stand_ok, v_at_shop)
  returning id into v_id;

  return jsonb_build_object('voucher', public._in_store_voucher_payload(v_id));
end $$;
