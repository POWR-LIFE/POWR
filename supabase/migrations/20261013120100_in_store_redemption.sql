-- In-store redemption, step 2 of 2: shop sites, per-reward settings, staff
-- scan links, live vouchers, and the RPCs the member app, the staff scan page
-- (powr.life/scan) and the partner portal call.
--
-- How it works
--   * A member claims an in-store reward with points exactly as today
--     (redeem-reward). Nothing about spending changes.
--   * At the till they tap "Use in store": in_store_open_voucher() opens a
--     short-lived voucher (default 5 minutes). Its secret drives a QR and a
--     6-character typed code that rotate every 10 seconds on the member's
--     phone (shared/inStore.ts; same derivation as in_store_voucher_proof /
--     in_store_typed_code below, pinned by __tests__/inStore.test.ts).
--     A screenshot is stale within seconds.
--   * OPENING NEVER USES THE REWARD UP. Only three things do:
--       - a staff scan, in_store_scan_confirm(): "confirmed". This also flips
--         a backing pool code reserved -> used, the brand-confirmed meaning
--         `used` has everywhere else, so the code.used webhook fires.
--       - a staff swipe on the member's phone, in_store_swipe_voucher():
--         "swiped". The member has had it, but the shop never confirmed it,
--         so a backing code is NOT flipped and reports keep it separate.
--       - a chain's till scanning its own barcode: reconciled from the
--         brand's used-codes list (the existing Promo Codes > Reconcile).
--   * redemptions.status becomes 'used' on confirm or swipe ("the member no
--     longer holds a claim"), which moves the reward to wallet History.
--
-- Staff don't get portal accounts. A brand creates a personal scan link per
-- person (reward_brand_staff). The page keeps the token, every scan is tied
-- to a person and a site, and revoking the link ends it. Signed-in portal
-- users can scan too.
--
-- Partners edit all of this directly. It's operational, like the delivery
-- method, so it skips the reward-submission approval queue.
--
-- Brand scoping follows the house idiom: lower(btrim(brand_name)) matches,
-- brand forced server-side for brand users, admins may name a brand
-- (portal admin preview). Tables are read-only to clients; every write goes
-- through a SECURITY DEFINER function below.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.reward_brand_sites (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  address text check (address is null or length(address) <= 200),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- How close counts as "in the shop" for the location check.
  radius_m integer not null default 75 check (radius_m between 20 and 500),
  -- Printed on the counter stand: https://powr.life/s/<stand_code>?k=<stand_key>.
  stand_code text not null unique,
  stand_key text not null default encode(extensions.gen_random_bytes(8), 'hex'),
  -- Never printed: the till tablet derives a key from it every 30 seconds.
  stand_secret text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reward_brand_sites_brand_idx on public.reward_brand_sites (lower(btrim(brand_name)));

create table if not exists public.reward_in_store (
  reward_id uuid primary key references public.rewards(id) on delete cascade,
  redeem_where text not null default 'in_store' check (redeem_where in ('online', 'in_store', 'both')),
  check_method text not null default 'staff_scan' check (check_method in ('staff_scan', 'look', 'till_barcode')),
  requires_stand boolean not null default false,
  ask_spend boolean not null default true,
  window_minutes integer not null default 5 check (window_minutes between 1 and 30),
  barcode_format text not null default 'code128' check (barcode_format in ('ean13', 'code128', 'qr')),
  -- null = every active site of the brand, including ones added later.
  site_ids uuid[],
  -- The code-backed type to restore when a reward stops being in-store only.
  online_integration_type text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_brand_staff (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  site_id uuid references public.reward_brand_sites(id) on delete set null,
  -- sha256 of the token in the personal scan link. The token itself is shown once.
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index if not exists reward_brand_staff_brand_idx on public.reward_brand_staff (lower(btrim(brand_name)));

create table if not exists public.in_store_vouchers (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.redemptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id uuid not null references public.rewards(id) on delete cascade,
  brand_name text not null,
  -- Where the member was when they opened it (stand scanned, or nearest site).
  site_id uuid references public.reward_brand_sites(id) on delete set null,
  secret text not null,
  -- 'open' past expires_at reads as "closed unused".
  status text not null default 'open' check (status in ('open', 'swiped', 'confirmed')),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  open_lat double precision,
  open_lng double precision,
  open_accuracy_m double precision,
  open_distance_m integer,
  stand_scanned boolean not null default false,
  at_shop boolean not null default false,
  swiped_at timestamptz,
  -- Issued by a successful staff check; the confirm must present it.
  check_ticket text,
  checked_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_staff_id uuid references public.reward_brand_staff(id) on delete set null,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  confirm_site_id uuid references public.reward_brand_sites(id) on delete set null,
  spend_pence integer check (spend_pence is null or spend_pence between 0 and 1000000)
);
create index if not exists in_store_vouchers_redemption_idx on public.in_store_vouchers (redemption_id, opened_at desc);
create index if not exists in_store_vouchers_brand_idx on public.in_store_vouchers (lower(btrim(brand_name)), opened_at desc);
create index if not exists in_store_vouchers_open_idx on public.in_store_vouchers (lower(btrim(brand_name))) where status in ('open', 'swiped');

-- ---------------------------------------------------------------------------
-- RLS: reads only. Every write goes through the functions below.
-- ---------------------------------------------------------------------------

alter table public.reward_brand_sites enable row level security;
alter table public.reward_in_store enable row level security;
alter table public.reward_brand_staff enable row level security;
alter table public.in_store_vouchers enable row level security;

drop policy if exists "Brand users read own sites" on public.reward_brand_sites;
create policy "Brand users read own sites" on public.reward_brand_sites for select to authenticated
  using (exists (select 1 from public.reward_brand_users u
                 where u.user_id = (select auth.uid())
                   and lower(btrim(u.brand_name)) = lower(btrim(reward_brand_sites.brand_name))));
drop policy if exists "Admins read sites" on public.reward_brand_sites;
create policy "Admins read sites" on public.reward_brand_sites for select to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy if exists "Brand users read own in-store settings" on public.reward_in_store;
create policy "Brand users read own in-store settings" on public.reward_in_store for select to authenticated
  using (exists (select 1 from public.rewards r
                 join public.reward_brand_users u on lower(btrim(u.brand_name)) = lower(btrim(r.brand_name))
                 where r.id = reward_in_store.reward_id and u.user_id = (select auth.uid())));
drop policy if exists "Admins read in-store settings" on public.reward_in_store;
create policy "Admins read in-store settings" on public.reward_in_store for select to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy if exists "Brand users read own staff" on public.reward_brand_staff;
create policy "Brand users read own staff" on public.reward_brand_staff for select to authenticated
  using (exists (select 1 from public.reward_brand_users u
                 where u.user_id = (select auth.uid())
                   and lower(btrim(u.brand_name)) = lower(btrim(reward_brand_staff.brand_name))));
drop policy if exists "Admins read staff" on public.reward_brand_staff;
create policy "Admins read staff" on public.reward_brand_staff for select to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy if exists "Members read own vouchers" on public.in_store_vouchers;
create policy "Members read own vouchers" on public.in_store_vouchers for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Brand users read own vouchers" on public.in_store_vouchers;
create policy "Brand users read own vouchers" on public.in_store_vouchers for select to authenticated
  using (exists (select 1 from public.reward_brand_users u
                 where u.user_id = (select auth.uid())
                   and lower(btrim(u.brand_name)) = lower(btrim(in_store_vouchers.brand_name))));
drop policy if exists "Admins read vouchers" on public.in_store_vouchers;
create policy "Admins read vouchers" on public.in_store_vouchers for select to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Pure helpers: the rotating code. Keep in lockstep with shared/inStore.ts.
-- ---------------------------------------------------------------------------

create or replace function public.in_store_voucher_proof(p_secret text, p_step bigint)
returns text language sql immutable parallel safe set search_path = ''
as $$ select left(encode(extensions.digest(p_secret || ':' || p_step::text, 'sha256'), 'hex'), 16) $$;

create or replace function public.in_store_typed_code(p_secret text, p_step bigint)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(x.d, i) % 31) + 1, 1), '' order by i)
  from (select extensions.digest(p_secret || ':' || p_step::text, 'sha256') as d) x,
       generate_series(0, 5) as i
$$;

create or replace function public.in_store_stand_key(p_secret text, p_step bigint)
returns text language sql immutable parallel safe set search_path = ''
as $$ select left(encode(extensions.digest(p_secret || ':stand:' || p_step::text, 'sha256'), 'hex'), 16) $$;

-- "Alex M." for staff and reports: first name and last initial, never the full name.
create or replace function public._in_store_member_label(p_user uuid)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select case when array_length(x.parts, 1) >= 2
                 then x.parts[1] || ' ' || left(x.parts[array_length(x.parts, 1)], 1) || '.'
                 else x.parts[1] end
       from (select regexp_split_to_array(btrim(p.display_name), '\s+') as parts) x
      where nullif(btrim(p.display_name), '') is not null),
    nullif(btrim(p.username), ''),
    'POWR member')
  from public.profiles p where p.id = p_user
$$;

-- The calling portal user's brand. Brand users are forced to their own brand;
-- admins previewing the portal name one.
create or replace function public._in_store_caller_brand(p_brand text)
returns text language plpgsql stable security definer set search_path = public
as $$
declare v_brand text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  select btrim(u.brand_name) into v_brand from public.reward_brand_users u where u.user_id = auth.uid();
  if v_brand is not null then return v_brand; end if;
  if exists (select 1 from public.admin_roles where user_id = auth.uid()) and nullif(btrim(p_brand), '') is not null then
    return btrim(p_brand);
  end if;
  raise exception 'This login is not linked to a brand' using errcode = '42501';
end $$;

-- Who is scanning: a personal staff link (token) or a signed-in portal user.
create or replace function public._in_store_scanner(p_token text)
returns table (brand_name text, staff_id uuid, staff_name text, staff_site_id uuid, user_id uuid)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare r record;
begin
  if nullif(btrim(p_token), '') is not null then
    select s.* into r from public.reward_brand_staff s
     where s.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
       and s.revoked_at is null;
    if not found then raise exception 'This scan link no longer works. Ask your manager for a new one.' using errcode = '42501'; end if;
    update public.reward_brand_staff set last_seen_at = now() where id = r.id;
    return query select btrim(r.brand_name), r.id, r.name, r.site_id, null::uuid;
    return;
  end if;
  if auth.uid() is not null then
    return query select btrim(u.brand_name), null::uuid, null::text, null::uuid, u.user_id
      from public.reward_brand_users u where u.user_id = auth.uid();
    if found then return; end if;
  end if;
  raise exception 'Open your scan link, or sign in to the partner portal.' using errcode = '42501';
end $$;

create or replace function public._in_store_new_stand_code(p_name text)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare
  v_prefix text := rpad(upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'), 3)), 3, 'X');
  v_code text;
begin
  for i in 1..99 loop
    v_code := v_prefix || '-' || lpad(i::text, 2, '0');
    if not exists (select 1 from public.reward_brand_sites where stand_code = v_code) then return v_code; end if;
  end loop;
  return v_prefix || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
end $$;

-- Everything the member's voucher screen needs, for the voucher's owner only.
create or replace function public._in_store_voucher_payload(p_voucher_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'voucher_id', v.id,
    'redemption_id', v.redemption_id,
    'secret', v.secret,
    'status', v.status,
    'closed', v.status = 'open' and v.expires_at <= now(),
    'opened_at', v.opened_at,
    'expires_at', v.expires_at,
    'server_now', clock_timestamp(),
    'step_seconds', 10,
    'check', c.check_method,
    'window_minutes', c.window_minutes,
    'reward_title', coalesce(d.reward_title, r.title),
    'brand_name', coalesce(d.partner_name, r.brand_name),
    'site_name', s.name,
    'at_shop', v.at_shop,
    'member_label', coalesce(public._in_store_member_label(v.user_id), 'POWR member'),
    'member_since', to_char(p.created_at, 'Mon YYYY'),
    'swiped_at', v.swiped_at,
    'confirmed_at', v.confirmed_at,
    'confirmed_by', case when v.confirmed_by_staff_id is not null then 'staff'
                         when v.confirmed_by_user_id is not null then 'manager' end,
    'confirm_site_name', cs.name
  )
  from public.in_store_vouchers v
  join public.redemptions d on d.id = v.redemption_id
  join public.rewards r on r.id = v.reward_id
  left join public.reward_in_store c on c.reward_id = v.reward_id
  left join public.reward_brand_sites s on s.id = v.site_id
  left join public.reward_brand_sites cs on cs.id = v.confirm_site_id
  left join public.profiles p on p.id = v.user_id
  where v.id = p_voucher_id
$$;

-- ---------------------------------------------------------------------------
-- Keep reward_in_store in step with rewards.integration_type.
-- 'IN_STORE' <=> in-store only, checked by staff scan or by looking.
-- Admin approval of an "In store" submission sets the type; this gives it
-- settings. An admin moving a reward off 'IN_STORE' turns in-store off.
-- ---------------------------------------------------------------------------

create or replace function public.tg_rewards_in_store_sync()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.integration_type::text = 'IN_STORE' then
    insert into public.reward_in_store (reward_id, redeem_where, check_method)
    values (new.id, 'in_store', 'staff_scan')
    on conflict (reward_id) do update
      set redeem_where = 'in_store',
          check_method = case when reward_in_store.check_method = 'till_barcode' then 'staff_scan' else reward_in_store.check_method end,
          updated_at = now()
      where reward_in_store.redeem_where <> 'in_store' or reward_in_store.check_method = 'till_barcode';
  elsif tg_op = 'UPDATE' and old.integration_type::text = 'IN_STORE' then
    update public.reward_in_store set redeem_where = 'online', updated_at = now()
     where reward_id = new.id and redeem_where = 'in_store' and check_method <> 'till_barcode';
  end if;
  return null;
end $$;

drop trigger if exists trg_rewards_in_store_sync on public.rewards;
create trigger trg_rewards_in_store_sync
  after insert or update of integration_type on public.rewards
  for each row execute function public.tg_rewards_in_store_sync();

-- ---------------------------------------------------------------------------
-- Member app
-- ---------------------------------------------------------------------------

-- In-store settings and shops for the rewards in a member's wallet.
create or replace function public.member_in_store_rewards(p_reward_ids uuid[])
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'reward_id', c.reward_id,
    'where', c.redeem_where,
    'check', c.check_method,
    'requires_stand', c.requires_stand,
    'window_minutes', c.window_minutes,
    'barcode_format', c.barcode_format,
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address,
                                          'lat', b.lat, 'lng', b.lng, 'radius_m', b.radius_m) order by b.name)
        from public.reward_brand_sites b
       where b.active
         and lower(btrim(b.brand_name)) = lower(btrim(r.brand_name))
         and (c.site_ids is null or b.id = any(c.site_ids))), '[]'::jsonb)
  )), '[]'::jsonb)
  from public.reward_in_store c
  join public.rewards r on r.id = c.reward_id
  where c.reward_id = any(coalesce(p_reward_ids, '{}'))
    and c.redeem_where <> 'online'
    and r.brand_name is not null
$$;

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
    if not found
       or lower(btrim(v_stand.brand_name)) <> lower(v_brand)
       or (v_cfg.site_ids is not null and not (v_stand.id = any(v_cfg.site_ids))) then
      return jsonb_build_object('error', 'STAND_OTHER_SHOP');
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

create or replace function public.in_store_voucher_status(p_voucher_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.in_store_vouchers where id = p_voucher_id and user_id = auth.uid()) then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('voucher', public._in_store_voucher_payload(p_voucher_id));
end $$;

-- The member's "Staff: swipe to redeem": the honour path.
create or replace function public.in_store_swipe_voucher(p_voucher_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v public.in_store_vouchers%rowtype;
begin
  select * into v from public.in_store_vouchers where id = p_voucher_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v.status in ('swiped', 'confirmed') then
    return jsonb_build_object('voucher', public._in_store_voucher_payload(v.id));
  end if;
  -- A few seconds' grace for a swipe that started just before the timer ran out.
  if v.expires_at < now() - interval '15 seconds' then return jsonb_build_object('error', 'CLOSED'); end if;
  if exists (select 1 from public.redemptions where id = v.redemption_id and status <> 'active') then
    return jsonb_build_object('error', 'ALREADY_USED');
  end if;

  update public.in_store_vouchers set status = 'swiped', swiped_at = now() where id = v.id;
  update public.redemptions set status = 'used', used_at = coalesce(used_at, now())
   where id = v.redemption_id and status = 'active';
  return jsonb_build_object('voucher', public._in_store_voucher_payload(v.id));
end $$;

-- ---------------------------------------------------------------------------
-- Staff scan page (powr.life/scan): staff link token or signed-in portal user
-- ---------------------------------------------------------------------------

create or replace function public.in_store_scan_session(p_token text default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare s record;
begin
  select * into s from public._in_store_scanner(p_token);
  return jsonb_build_object(
    'brand_name', s.brand_name,
    'staff', case when s.staff_id is null then null
                  else jsonb_build_object('id', s.staff_id, 'name', s.staff_name, 'site_id', s.staff_site_id) end,
    'manager', s.user_id is not null,
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'stand_code', b.stand_code) order by b.name)
                         from public.reward_brand_sites b
                        where b.active and lower(btrim(b.brand_name)) = lower(s.brand_name)), '[]'::jsonb),
    'server_now', clock_timestamp());
end $$;

create or replace function public.in_store_scan_check(
  p_token text default null,
  p_site_id uuid default null,
  p_voucher_id uuid default null,
  p_proof text default null,
  p_typed_code text default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
  v public.in_store_vouchers%rowtype;
  v_cfg public.reward_in_store%rowtype;
  v_red public.redemptions%rowtype;
  v_step bigint := floor(extract(epoch from clock_timestamp()) / 10)::bigint;
  v_code text := upper(regexp_replace(coalesce(p_typed_code, ''), '[\s-]', '', 'g'));
  v_proof_ok boolean;
  v_ticket text;
  v_used_site text;
begin
  select * into s from public._in_store_scanner(p_token);

  if p_voucher_id is not null then
    select * into v from public.in_store_vouchers where id = p_voucher_id;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
  elsif length(v_code) = 6 then
    -- Typed fallback: search this brand's live vouchers for the current code.
    select x.* into v from public.in_store_vouchers x
     where lower(btrim(x.brand_name)) = lower(s.brand_name)
       and x.status in ('open', 'swiped')
       and x.expires_at > now() - interval '2 minutes'
       and v_code in (public.in_store_typed_code(x.secret, v_step),
                      public.in_store_typed_code(x.secret, v_step - 1),
                      public.in_store_typed_code(x.secret, v_step - 2),
                      public.in_store_typed_code(x.secret, v_step - 3),
                      public.in_store_typed_code(x.secret, v_step + 1))
     order by x.opened_at desc
     limit 1;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
  else
    return jsonb_build_object('result', 'not_found');
  end if;

  if lower(btrim(v.brand_name)) <> lower(s.brand_name) then
    return jsonb_build_object('result', 'other');
  end if;

  select * into v_red from public.redemptions where id = v.redemption_id;
  select * into v_cfg from public.reward_in_store where reward_id = v.reward_id;

  if v.status = 'confirmed' or (v_red.status = 'used' and v.status <> 'swiped') then
    select b.name into v_used_site from public.in_store_vouchers c
      left join public.reward_brand_sites b on b.id = c.confirm_site_id
     where c.redemption_id = v.redemption_id and c.status = 'confirmed'
     order by c.confirmed_at desc limit 1;
    return jsonb_build_object('result', 'used',
      'reward_title', coalesce(v_red.reward_title, (select title from public.rewards where id = v.reward_id)),
      'used_at', coalesce(v.confirmed_at, v_red.used_at),
      'used_site_name', v_used_site);
  end if;

  -- A scanned QR must carry a code from the last ~40 seconds: a screenshot won't.
  if p_voucher_id is not null then
    v_proof_ok := lower(coalesce(p_proof, '')) in (
      public.in_store_voucher_proof(v.secret, v_step),
      public.in_store_voucher_proof(v.secret, v_step - 1),
      public.in_store_voucher_proof(v.secret, v_step - 2),
      public.in_store_voucher_proof(v.secret, v_step - 3),
      public.in_store_voucher_proof(v.secret, v_step + 1));
    if not v_proof_ok then return jsonb_build_object('result', 'stale'); end if;
  end if;

  if v.status = 'open' and v.expires_at <= now() then
    return jsonb_build_object('result', 'closed');
  end if;

  v_ticket := encode(extensions.gen_random_bytes(12), 'hex');
  update public.in_store_vouchers set check_ticket = v_ticket, checked_at = now() where id = v.id;

  return jsonb_build_object(
    'result', 'valid',
    'voucher_id', v.id,
    'ticket', v_ticket,
    'reward_title', coalesce(v_red.reward_title, (select title from public.rewards where id = v.reward_id)),
    'member_label', coalesce(public._in_store_member_label(v.user_id), 'POWR member'),
    'opened_at', v.opened_at,
    'expires_at', v.expires_at,
    'swiped', v.status = 'swiped',
    'ask_spend', coalesce(v_cfg.ask_spend, false),
    'server_now', clock_timestamp());
end $$;

create or replace function public.in_store_scan_confirm(
  p_token text default null,
  p_site_id uuid default null,
  p_voucher_id uuid default null,
  p_ticket text default null,
  p_spend_pence integer default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
  v public.in_store_vouchers%rowtype;
  v_cfg public.reward_in_store%rowtype;
  v_red public.redemptions%rowtype;
  v_site uuid;
begin
  select * into s from public._in_store_scanner(p_token);
  select * into v from public.in_store_vouchers where id = p_voucher_id for update;
  if not found or lower(btrim(v.brand_name)) <> lower(s.brand_name) then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;
  if v.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'confirmed_at', v.confirmed_at, 'already', true);
  end if;
  if v.check_ticket is null or v.check_ticket <> coalesce(p_ticket, '') or v.checked_at < now() - interval '5 minutes' then
    return jsonb_build_object('error', 'CHECK_AGAIN');
  end if;
  select * into v_red from public.redemptions where id = v.redemption_id for update;
  if v_red.status not in ('active', 'used') or (v_red.status = 'used' and v.status <> 'swiped') then
    return jsonb_build_object('error', 'ALREADY_USED');
  end if;
  select * into v_cfg from public.reward_in_store where reward_id = v.reward_id;

  select b.id into v_site from public.reward_brand_sites b
   where b.id = coalesce(p_site_id, s.staff_site_id, v.site_id)
     and lower(btrim(b.brand_name)) = lower(s.brand_name);

  update public.in_store_vouchers
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_staff_id = s.staff_id,
         confirmed_by_user_id = s.user_id,
         confirm_site_id = v_site,
         spend_pence = case when coalesce(v_cfg.ask_spend, false) and p_spend_pence between 0 and 1000000 then p_spend_pence end,
         check_ticket = null
   where id = v.id;

  update public.redemptions set status = 'used', used_at = coalesce(used_at, now()) where id = v.redemption_id;

  -- The shop confirmed it: a backing pool code becomes `used` (brand-confirmed),
  -- which fires the brand's code.used webhook via trg_code_used_webhook.
  if v_red.code_id is not null then
    update public.redemption_codes set status = 'used', used_at = now()
     where id = v_red.code_id and status = 'reserved';
  end if;

  return jsonb_build_object('ok', true, 'confirmed_at', now());
end $$;

-- Today's tally for the scan page and the till tablet.
create or replace function public.in_store_scan_today(p_token text default null, p_site_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
  v_since timestamptz := date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London';
begin
  select * into s from public._in_store_scanner(p_token);
  return (
    with v as (
      select x.* from public.in_store_vouchers x
       where lower(btrim(x.brand_name)) = lower(s.brand_name)
         and x.opened_at >= v_since
         and (p_site_id is null or coalesce(x.confirm_site_id, x.site_id) = p_site_id)
    )
    select jsonb_build_object(
      'confirmed', (select count(*) from v where status = 'confirmed'),
      'spend_pence', (select coalesce(sum(spend_pence), 0) from v where status = 'confirmed'),
      'latest', coalesce((
        select jsonb_agg(row_to_json(t) order by t.at desc)
          from (select coalesce(v.confirmed_at, v.swiped_at, v.opened_at) as at,
                       coalesce(public._in_store_member_label(v.user_id), 'POWR member') as member,
                       coalesce(d.reward_title, r.title) as reward,
                       case when v.status = 'open' and v.expires_at <= now() then 'closed' else v.status end as status
                  from v
                  join public.redemptions d on d.id = v.redemption_id
                  join public.rewards r on r.id = v.reward_id
                 order by coalesce(v.confirmed_at, v.swiped_at, v.opened_at) desc
                 limit 12) t), '[]'::jsonb))
  );
end $$;

-- The till tablet's stand: it derives a fresh key every 30 seconds.
create or replace function public.in_store_kiosk(p_token text default null, p_site_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare s record; b public.reward_brand_sites%rowtype;
begin
  select * into s from public._in_store_scanner(p_token);
  select * into b from public.reward_brand_sites
   where id = coalesce(p_site_id, s.staff_site_id) and active and lower(btrim(brand_name)) = lower(s.brand_name);
  if not found then return jsonb_build_object('error', 'PICK_A_SITE'); end if;
  return jsonb_build_object('site_id', b.id, 'site_name', b.name, 'stand_code', b.stand_code,
                            'stand_secret', b.stand_secret, 'server_now', clock_timestamp());
end $$;

-- ---------------------------------------------------------------------------
-- Partner portal
-- ---------------------------------------------------------------------------

create or replace function public.partner_in_store_overview(p_brand text default null)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_brand text := public._in_store_caller_brand(p_brand);
begin
  return jsonb_build_object(
    'brand_name', v_brand,
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'address', b.address, 'lat', b.lat, 'lng', b.lng,
        'radius_m', b.radius_m, 'stand_code', b.stand_code, 'stand_key', b.stand_key, 'active', b.active,
        'last_scan_at', (select max(v.confirmed_at) from public.in_store_vouchers v where v.confirm_site_id = b.id),
        'last_swipe_at', (select max(v.swiped_at) from public.in_store_vouchers v where v.site_id = b.id)
      ) order by b.active desc, b.name)
      from public.reward_brand_sites b where lower(btrim(b.brand_name)) = lower(v_brand)), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', st.id, 'name', st.name, 'site_id', st.site_id, 'created_at', st.created_at,
        'last_seen_at', st.last_seen_at,
        'last_scan_at', (select max(v.confirmed_at) from public.in_store_vouchers v where v.confirmed_by_staff_id = st.id)
      ) order by st.name)
      from public.reward_brand_staff st
      where lower(btrim(st.brand_name)) = lower(v_brand) and st.revoked_at is null), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'active', r.active, 'image_url', r.image_url,
        'integration_type', r.integration_type, 'promo_code', r.promo_code,
        'where', coalesce(c.redeem_where, 'online'),
        'check', coalesce(c.check_method, 'staff_scan'),
        'requires_stand', coalesce(c.requires_stand, false),
        'ask_spend', coalesce(c.ask_spend, true),
        'window_minutes', coalesce(c.window_minutes, 5),
        'barcode_format', coalesce(c.barcode_format, 'code128'),
        'site_ids', c.site_ids
      ) order by r.active desc, r.created_at desc)
      from public.rewards r
      left join public.reward_in_store c on c.reward_id = r.id
      where lower(btrim(r.brand_name)) = lower(v_brand) and r.reward_kind = 'digital'), '[]'::jsonb));
end $$;

create or replace function public.partner_save_site(
  p_brand text,
  p_site_id uuid,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 75
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v_brand text := public._in_store_caller_brand(p_brand); v_id uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Give the site a name' using errcode = '22023'; end if;
  if p_lat is null or p_lng is null then raise exception 'Drop a pin on the map for this site' using errcode = '22023'; end if;
  if p_site_id is null then
    insert into public.reward_brand_sites (brand_name, name, address, lat, lng, radius_m, stand_code, created_by)
    values (v_brand, btrim(p_name), nullif(btrim(p_address), ''), p_lat, p_lng,
            least(greatest(coalesce(p_radius_m, 75), 20), 500), public._in_store_new_stand_code(p_name), auth.uid())
    returning id into v_id;
  else
    update public.reward_brand_sites
       set name = btrim(p_name), address = nullif(btrim(p_address), ''), lat = p_lat, lng = p_lng,
           radius_m = least(greatest(coalesce(p_radius_m, 75), 20), 500), active = true, updated_at = now()
     where id = p_site_id and lower(btrim(brand_name)) = lower(v_brand)
    returning id into v_id;
    if v_id is null then raise exception 'Site not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.partner_archive_site(p_brand text, p_site_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v_brand text := public._in_store_caller_brand(p_brand);
begin
  update public.reward_brand_sites set active = false, updated_at = now()
   where id = p_site_id and lower(btrim(brand_name)) = lower(v_brand);
  if not found then raise exception 'Site not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- A new key for the printed stand: old printouts stop working.
create or replace function public.partner_rotate_stand(p_brand text, p_site_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v_brand text := public._in_store_caller_brand(p_brand); v_key text;
begin
  update public.reward_brand_sites
     set stand_key = encode(extensions.gen_random_bytes(8), 'hex'),
         stand_secret = encode(extensions.gen_random_bytes(16), 'hex'),
         updated_at = now()
   where id = p_site_id and lower(btrim(brand_name)) = lower(v_brand)
  returning stand_key into v_key;
  if v_key is null then raise exception 'Site not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('stand_key', v_key);
end $$;

-- Returns the token once. Only its hash is kept.
create or replace function public.partner_create_staff(p_brand text, p_name text, p_site_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_brand text := public._in_store_caller_brand(p_brand);
  v_token text := encode(extensions.gen_random_bytes(16), 'hex');
  v_id uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Add their name' using errcode = '22023'; end if;
  if p_site_id is not null and not exists (
    select 1 from public.reward_brand_sites where id = p_site_id and lower(btrim(brand_name)) = lower(v_brand)) then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;
  insert into public.reward_brand_staff (brand_name, name, site_id, token_hash, created_by)
  values (v_brand, btrim(p_name), p_site_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- A fresh link for someone who lost theirs; the old one stops working.
create or replace function public.partner_reissue_staff(p_brand text, p_staff_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v_brand text := public._in_store_caller_brand(p_brand); v_token text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  update public.reward_brand_staff set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
   where id = p_staff_id and revoked_at is null and lower(btrim(brand_name)) = lower(v_brand);
  if not found then raise exception 'Staff member not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', p_staff_id, 'token', v_token);
end $$;

create or replace function public.partner_revoke_staff(p_brand text, p_staff_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v_brand text := public._in_store_caller_brand(p_brand);
begin
  update public.reward_brand_staff set revoked_at = now()
   where id = p_staff_id and revoked_at is null and lower(btrim(brand_name)) = lower(v_brand);
  if not found then raise exception 'Staff member not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.partner_set_reward_in_store(
  p_brand text,
  p_reward_id uuid,
  p_where text,
  p_check text default 'staff_scan',
  p_requires_stand boolean default false,
  p_ask_spend boolean default true,
  p_window_minutes integer default 5,
  p_barcode_format text default 'code128',
  p_site_ids uuid[] default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_brand text := public._in_store_caller_brand(p_brand);
  v_reward public.rewards%rowtype;
  v_prior text;
  v_only boolean;
begin
  if p_where not in ('online', 'in_store', 'both') then raise exception 'Pick online, in store or both' using errcode = '22023'; end if;
  if p_check not in ('staff_scan', 'look', 'till_barcode') then raise exception 'Pick how your shop checks it' using errcode = '22023'; end if;
  if p_barcode_format not in ('ean13', 'code128', 'qr') then raise exception 'Unknown barcode type' using errcode = '22023'; end if;

  select * into v_reward from public.rewards where id = p_reward_id and lower(btrim(brand_name)) = lower(v_brand) for update;
  if not found then raise exception 'Reward not found' using errcode = 'P0002'; end if;
  if v_reward.reward_kind <> 'digital' then raise exception 'Posted rewards can''t be used in store' using errcode = '22023'; end if;
  if p_where <> 'online' and v_reward.integration_type::text = 'AFFILIATE' and p_check = 'till_barcode' then
    raise exception 'A link reward has no codes for a till to scan. Use staff scan or look at the screen.' using errcode = '22023';
  end if;

  select online_integration_type into v_prior from public.reward_in_store where reward_id = p_reward_id;
  v_only := p_where = 'in_store' and p_check in ('staff_scan', 'look');

  insert into public.reward_in_store (reward_id, redeem_where, check_method, requires_stand, ask_spend,
                                      window_minutes, barcode_format, site_ids, online_integration_type,
                                      updated_by, updated_at)
  values (p_reward_id, p_where, p_check, coalesce(p_requires_stand, false), coalesce(p_ask_spend, true),
          least(greatest(coalesce(p_window_minutes, 5), 1), 30), p_barcode_format,
          case when p_site_ids is null or cardinality(p_site_ids) = 0 then null else p_site_ids end,
          case when v_reward.integration_type::text <> 'IN_STORE' then v_reward.integration_type::text else v_prior end,
          auth.uid(), now())
  on conflict (reward_id) do update set
    redeem_where = excluded.redeem_where,
    check_method = excluded.check_method,
    requires_stand = excluded.requires_stand,
    ask_spend = excluded.ask_spend,
    window_minutes = excluded.window_minutes,
    barcode_format = excluded.barcode_format,
    site_ids = excluded.site_ids,
    online_integration_type = excluded.online_integration_type,
    updated_by = excluded.updated_by,
    updated_at = now();

  -- In-store only (no codes) <=> IN_STORE. Anything else needs its code source back.
  if v_only and v_reward.integration_type::text <> 'IN_STORE' then
    update public.rewards set integration_type = 'IN_STORE' where id = p_reward_id;
  elsif not v_only and v_reward.integration_type::text = 'IN_STORE' then
    update public.rewards
       set integration_type = coalesce(nullif(v_prior, 'IN_STORE'), 'POOL')::public.reward_integration_type
     where id = p_reward_id;
  end if;

  return jsonb_build_object('ok', true,
    'integration_type', (select integration_type from public.rewards where id = p_reward_id));
end $$;

create or replace function public.partner_in_store_report(p_brand text default null, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_brand text := public._in_store_caller_brand(p_brand);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  return (
    with v as (
      select x.* from public.in_store_vouchers x
       where lower(btrim(x.brand_name)) = lower(v_brand) and x.opened_at >= v_since
    ),
    -- One outcome per claimed reward, however many times the voucher was opened.
    per as (
      select v.redemption_id,
             bool_or(v.status = 'confirmed') as confirmed,
             bool_or(v.status = 'swiped') as swiped,
             bool_or(v.status = 'open' and v.expires_at > now()) as open_now,
             max(v.spend_pence) filter (where v.status = 'confirmed') as spend_pence,
             coalesce((array_agg(v.confirm_site_id order by v.confirmed_at desc) filter (where v.status = 'confirmed'))[1],
                      (array_agg(v.site_id order by v.opened_at desc) filter (where v.site_id is not null))[1]) as site_id,
             max(coalesce(v.confirmed_at, v.swiped_at, v.opened_at)) as last_at,
             (array_agg(v.id order by coalesce(v.confirmed_at, v.swiped_at, v.opened_at) desc))[1] as last_voucher_id
        from v group by v.redemption_id
    ),
    outcome as (
      select per.*,
             case when confirmed then 'confirmed' when swiped then 'swiped' when open_now then 'open' else 'closed' end as result
        from per
    )
    select jsonb_build_object(
      'brand_name', v_brand,
      'days', least(greatest(coalesce(p_days, 30), 1), 365),
      'totals', (select jsonb_build_object(
          'opened', count(*),
          'confirmed', count(*) filter (where result = 'confirmed'),
          'swiped', count(*) filter (where result = 'swiped'),
          'closed', count(*) filter (where result = 'closed'),
          'open_now', count(*) filter (where result = 'open'),
          'spend_pence', coalesce(sum(spend_pence), 0),
          'spend_visits', count(spend_pence)) from outcome),
      'by_site', coalesce((
        select jsonb_agg(jsonb_build_object(
          'site_id', o.site_id, 'site_name', coalesce(b.name, 'Not at a site'),
          'opened', o.opened, 'confirmed', o.confirmed, 'swiped', o.swiped, 'closed', o.closed,
          'spend_pence', o.spend_pence, 'spend_visits', o.spend_visits) order by o.opened desc)
          from (select site_id,
                       count(*) as opened,
                       count(*) filter (where result = 'confirmed') as confirmed,
                       count(*) filter (where result = 'swiped') as swiped,
                       count(*) filter (where result = 'closed') as closed,
                       coalesce(sum(spend_pence), 0) as spend_pence,
                       count(spend_pence) as spend_visits
                  from outcome group by site_id) o
          left join public.reward_brand_sites b on b.id = o.site_id), '[]'::jsonb),
      'latest', coalesce((
        select jsonb_agg(jsonb_build_object(
          'at', o.last_at,
          'member', coalesce(public._in_store_member_label(x.user_id), 'POWR member'),
          'reward', coalesce(d.reward_title, r.title),
          'site_name', coalesce(cb.name, sb.name),
          'result', o.result,
          'staff_name', st.name,
          'spend_pence', o.spend_pence) order by o.last_at desc)
          from (select * from outcome order by last_at desc limit 25) o
          join public.in_store_vouchers x on x.id = o.last_voucher_id
          join public.redemptions d on d.id = o.redemption_id
          join public.rewards r on r.id = x.reward_id
          left join public.reward_brand_sites cb on cb.id = x.confirm_site_id
          left join public.reward_brand_sites sb on sb.id = x.site_id
          left join public.reward_brand_staff st on st.id = x.confirmed_by_staff_id), '[]'::jsonb),
      -- Chains: barcodes handed out vs confirmed from the till report.
      'barcode', (select jsonb_build_object(
          'issued', count(*),
          'used', count(*) filter (where rc.status = 'used'))
          from public.redemptions d
          join public.reward_in_store c on c.reward_id = d.reward_id and c.check_method = 'till_barcode' and c.redeem_where <> 'online'
          join public.rewards r on r.id = d.reward_id and lower(btrim(r.brand_name)) = lower(v_brand)
          left join public.redemption_codes rc on rc.id = d.code_id
         where d.redeemed_at >= v_since and d.status <> 'refunded'))
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.in_store_voucher_proof(text, bigint) from public, anon, authenticated;
revoke all on function public.in_store_typed_code(text, bigint) from public, anon, authenticated;
revoke all on function public.in_store_stand_key(text, bigint) from public, anon, authenticated;
revoke all on function public._in_store_member_label(uuid) from public, anon, authenticated;
revoke all on function public._in_store_caller_brand(text) from public, anon, authenticated;
revoke all on function public._in_store_scanner(text) from public, anon, authenticated;
revoke all on function public._in_store_new_stand_code(text) from public, anon, authenticated;
revoke all on function public._in_store_voucher_payload(uuid) from public, anon, authenticated;
revoke all on function public.tg_rewards_in_store_sync() from public, anon, authenticated;

revoke all on function public.member_in_store_rewards(uuid[]) from public, anon;
revoke all on function public.in_store_open_voucher(uuid, double precision, double precision, double precision, text, text) from public, anon;
revoke all on function public.in_store_voucher_status(uuid) from public, anon;
revoke all on function public.in_store_swipe_voucher(uuid) from public, anon;
grant execute on function public.member_in_store_rewards(uuid[]) to authenticated;
grant execute on function public.in_store_open_voucher(uuid, double precision, double precision, double precision, text, text) to authenticated;
grant execute on function public.in_store_voucher_status(uuid) to authenticated;
grant execute on function public.in_store_swipe_voucher(uuid) to authenticated;

-- The scan page works signed out (staff link) or signed in (portal user).
revoke all on function public.in_store_scan_session(text) from public;
revoke all on function public.in_store_scan_check(text, uuid, uuid, text, text) from public;
revoke all on function public.in_store_scan_confirm(text, uuid, uuid, text, integer) from public;
revoke all on function public.in_store_scan_today(text, uuid) from public;
revoke all on function public.in_store_kiosk(text, uuid) from public;
grant execute on function public.in_store_scan_session(text) to anon, authenticated;
grant execute on function public.in_store_scan_check(text, uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.in_store_scan_confirm(text, uuid, uuid, text, integer) to anon, authenticated;
grant execute on function public.in_store_scan_today(text, uuid) to anon, authenticated;
grant execute on function public.in_store_kiosk(text, uuid) to anon, authenticated;

revoke all on function public.partner_in_store_overview(text) from public, anon;
revoke all on function public.partner_save_site(text, uuid, text, text, double precision, double precision, integer) from public, anon;
revoke all on function public.partner_archive_site(text, uuid) from public, anon;
revoke all on function public.partner_rotate_stand(text, uuid) from public, anon;
revoke all on function public.partner_create_staff(text, text, uuid) from public, anon;
revoke all on function public.partner_reissue_staff(text, uuid) from public, anon;
revoke all on function public.partner_revoke_staff(text, uuid) from public, anon;
revoke all on function public.partner_set_reward_in_store(text, uuid, text, text, boolean, boolean, integer, text, uuid[]) from public, anon;
revoke all on function public.partner_in_store_report(text, integer) from public, anon;
grant execute on function public.partner_in_store_overview(text) to authenticated;
grant execute on function public.partner_save_site(text, uuid, text, text, double precision, double precision, integer) to authenticated;
grant execute on function public.partner_archive_site(text, uuid) to authenticated;
grant execute on function public.partner_rotate_stand(text, uuid) to authenticated;
grant execute on function public.partner_create_staff(text, text, uuid) to authenticated;
grant execute on function public.partner_reissue_staff(text, uuid) to authenticated;
grant execute on function public.partner_revoke_staff(text, uuid) to authenticated;
grant execute on function public.partner_set_reward_in_store(text, uuid, text, text, boolean, boolean, integer, text, uuid[]) to authenticated;
grant execute on function public.partner_in_store_report(text, integer) to authenticated;

-- reward_submissions: partners can pick "In store" when they send a reward in.
alter table public.reward_submissions drop constraint if exists reward_submissions_delivery_method_check;
alter table public.reward_submissions add constraint reward_submissions_delivery_method_check
  check (delivery_method in ('code_pool', 'affiliate', 'manual_fulfilment', 'in_store'));
