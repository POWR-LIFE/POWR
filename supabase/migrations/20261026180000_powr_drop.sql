-- POWR Drop: the daily sealed reward, run by the server.
--
-- Each member gets one Drop a day (their own calendar day, profiles.timezone,
-- London when unset). Its target — N steps OR M active minutes, whichever
-- comes first — is set from their last 14 days the first time the app asks,
-- and frozen for the day. When either is met they open it: the server counts
-- the movement again, rolls a weighted prize from the pool admins keep in
-- /admin/drop, pays it, and records it, all in one transaction. The app only
-- shows the result.
--
-- Prizes: POWR now (a ledger `bonus` row, source 'drop'), POWR to the Vault
-- (a deposit, source 'drop'), or a partner code into the Wallet (a redemption
-- with 0 POWR spent, as live events issue them). Partner codes cost no POWR, so
-- the daily budget leaves them out; their own stock is their limit.
--
-- Nothing reaches members until drop_live leaves 'off'.
--
-- Bounds, since the payout runs as service_role and enforce_point_award_cap
-- passes it through: one drop_days row per member per day, locked during the
-- open; a CHECK of 100 POWR per prize; a daily POWR budget across everyone
-- (the fallback pool pays past it); per-prize stock; opens serialised by an
-- advisory lock so the budget and stock hold exactly.

-- ── 1. Settings ─────────────────────────────────────────────────────────────

insert into public.system_config (key, value, description)
values
  ('drop_live', 'off',
   'POWR Drop in the app: off, testers (admins + drop_testers) or on. Off always wins.'),
  ('drop_testers', '',
   'Comma-separated POWR user ids who get the Drop while drop_live is testers.'),
  ('drop_launch_at', '',
   'UTC time the Drop opens to everyone while drop_live is testers. Empty = no launch scheduled.'),
  ('drop_daily_budget', '1000',
   'Most POWR (now + Vault) all Drops pay in one London day. Partner codes cost no POWR and are not counted; the fallback pool pays past it.'),
  ('drop_starter_steps', '6000', 'Drop target in steps for members with under 5 known days.'),
  ('drop_starter_minutes', '20', 'Drop target in active minutes for members with under 5 known days.'),
  ('drop_stretch', '1.1', 'Drop target = the member''s typical day of steps times this.'),
  ('drop_steps_floor', '4000', 'Lowest Drop target in steps.'),
  ('drop_steps_ceiling', '15000', 'Highest Drop target in steps.'),
  ('drop_minutes_floor', '15', 'Lowest Drop target in active minutes.'),
  ('drop_minutes_ceiling', '60', 'Highest Drop target in active minutes.'),
  ('drop_comeback_share', '0.7', 'After days away, the Drop target is the typical day times this.'),
  ('drop_comeback_after_days', '3', 'Days since a member last moved before their Drop is a comeback.')
on conflict (key) do nothing;

-- ── 2. Tables ───────────────────────────────────────────────────────────────

-- The pool. 'daily' is rolled for every open; 'fallback' only when nothing in
-- 'daily' can pay (budget spent, stock gone), and it ignores the budget.
create table if not exists public.drop_prizes (
  id          uuid primary key default gen_random_uuid(),
  pool        text not null default 'daily' check (pool in ('daily', 'fallback')),
  kind        text not null check (kind in ('points', 'vault', 'partner')),
  amount      integer,
  reward_id   uuid references public.rewards(id) on delete cascade,
  weight      integer not null default 10 check (weight between 1 and 1000),
  stock       integer check (stock is null or stock >= 0),
  given       integer not null default 0 check (given >= 0),
  active      boolean not null default false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint drop_prizes_shape check (
    (kind in ('points', 'vault') and amount between 1 and 100 and reward_id is null)
    or (kind = 'partner' and reward_id is not null and amount is null)
  ),
  constraint drop_prizes_window check (starts_at is null or ends_at is null or starts_at < ends_at)
);

alter table public.drop_prizes enable row level security;
drop policy if exists drop_prizes_admin on public.drop_prizes;
create policy drop_prizes_admin on public.drop_prizes
  for all using ((select public.is_admin())) with check ((select public.is_admin()));

-- One row per member per day. Members never touch it directly: get_my_drop
-- and open_my_drop are the only way in, and admins read it for the log.
create table if not exists public.drop_days (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  day              date not null,
  tz               text not null,
  target_steps     integer not null,
  target_minutes   integer not null,
  basis            text not null check (basis in ('starter', 'history', 'recovery', 'comeback')),
  typical_steps    integer not null default 0,
  typical_minutes  integer not null default 0,
  comeback         boolean not null default false,
  days_away        integer,
  status           text not null default 'sealed' check (status in ('sealed', 'opened', 'void')),
  opened_at        timestamptz,
  steps_at_open    integer,
  minutes_at_open  integer,
  prize_id         uuid references public.drop_prizes(id) on delete set null,
  prize_kind       text check (prize_kind in ('points', 'vault', 'partner')),
  prize_amount     integer,
  prize_detail     jsonb,
  fallback         boolean not null default false,
  reward_id        uuid,
  point_tx_id      uuid,
  vault_deposit_id uuid,
  redemption_id    uuid,
  void_reason      text,
  void_detail      jsonb,
  voided_by        uuid,
  voided_at        timestamptz,
  reissue_reason   text,
  reissued_by      uuid,
  reissued_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint drop_days_one_a_day unique (user_id, day)
);

create index if not exists drop_days_day_idx on public.drop_days (day);
create index if not exists drop_days_opened_idx on public.drop_days (opened_at) where status = 'opened';

alter table public.drop_days enable row level security;
drop policy if exists drop_days_admin_read on public.drop_days;
create policy drop_days_admin_read on public.drop_days
  for select using ((select public.is_admin()));

-- Drop prizes bank to the Vault under their own source.
alter table public.vault_deposits drop constraint vault_deposits_source_check;
alter table public.vault_deposits add constraint vault_deposits_source_check
  check (source in ('level_up', 'cap_overflow', 'admin_grant', 'drop'));

-- The starting pool. Live from the start but harmless: drop_live is 'off'.
-- Partner codes are added from /admin/drop (pick the reward, set the stock).
insert into public.drop_prizes (pool, kind, amount, weight, active, note)
select v.pool, v.kind, v.amount, v.weight, true, v.note
  from (values
    ('daily',    'points', 20, 45, 'Launch pool'),
    ('daily',    'vault',  30, 40, 'Launch pool'),
    ('fallback', 'vault',  10, 1,  'Once the daily budget is spent')
  ) as v(pool, kind, amount, weight, note)
 where not exists (select 1 from public.drop_prizes);

-- ── 3. Helpers ──────────────────────────────────────────────────────────────

-- A numeric setting, or the default when it's missing or junk.
create or replace function public._drop_num(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when btrim(value) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(value)::numeric end
       from public.system_config where key = p_key),
    p_default);
$$;

-- A stored time, or null when it's empty or junk.
create or replace function public._drop_ts(p_text text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if nullif(btrim(coalesce(p_text, '')), '') is null then
    return null;
  end if;
  return btrim(p_text)::timestamptz;
exception when others then
  return null;
end;
$$;

-- The seeded POWR gym demo people never get a Drop (as the Series leaves them out).
create or replace function public._drop_is_demo(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_uid and u.raw_app_meta_data->>'seed' = 'powr-gym-demo'
  );
$$;

-- Is the Drop on for this member? Off always wins; testers mode lets in
-- admins and drop_testers, and everyone once drop_launch_at has passed.
create or replace function public._drop_enabled_for(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce((select value from public.system_config where key = 'drop_live'), 'off') as live,
           coalesce((select value from public.system_config where key = 'drop_testers'), '') as testers,
           public._drop_ts((select value from public.system_config where key = 'drop_launch_at')) as launch_at
  )
  select p_uid is not null
     and not public._drop_is_demo(p_uid)
     and case btrim(cfg.live)
           when 'on' then true
           when 'testers' then p_uid::text = any (string_to_array(replace(cfg.testers, ' ', ''), ','))
                            or exists (select 1 from public.admin_roles a where a.user_id = p_uid)
                            or (cfg.launch_at is not null and now() >= cfg.launch_at)
           else false
         end
    from cfg;
$$;

-- The member's time zone, London when unset or unknown to Postgres.
create or replace function public._drop_tz(p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  select nullif(btrim(timezone), '') into v from public.profiles where id = p_uid;
  if v is null then
    return 'Europe/London';
  end if;
  perform now() at time zone v;
  return v;
exception when others then
  return 'Europe/London';
end;
$$;

-- Steps and active minutes per local day, from p_from to p_to inclusive.
-- Steps = the day's walking row (the one walking points are paid from).
-- Minutes = workouts and gym visits, filtered as the Series ledger does (not
-- manual, not flagged, not sleep or walking), each counting at most 4 hours.
create or replace function public._drop_movement(p_uid uuid, p_tz text, p_from date, p_to date)
returns table (d date, steps integer, minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select g::date as d from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ),
  s as (
    select (a.started_at at time zone p_tz)::date as d,
           a.type::text as type,
           coalesce(a.steps, 0) as steps,
           greatest(coalesce(a.duration_sec, 0), 0) as duration_sec
      from public.activity_sessions a
     where a.user_id = p_uid
       and a.started_at >= (p_from::timestamp at time zone p_tz) - interval '1 day'
       and a.started_at <  ((p_to + 1)::timestamp at time zone p_tz) + interval '1 day'
       and a.verification::text <> 'manual'
       and not coalesce(a.flagged, false)
       and a.type::text <> 'sleep'
  )
  select days.d,
         coalesce((select max(s.steps) from s where s.d = days.d and s.type = 'walking'), 0)::integer,
         (coalesce((select sum(least(s.duration_sec, 14400)) from s
                     where s.d = days.d and s.type <> 'walking'), 0) / 60)::integer
    from days
   order by days.d;
$$;

-- lib/drop.ts median: the middle value, or the mean of the middle two.
create or replace function public._drop_median(p float8[])
returns float8
language sql
immutable
as $$
  with v as (
    select x, row_number() over (order by x) as rn, count(*) over () as c
      from unnest(p) x
  )
  select case when max(c) % 2 = 1 then max(x) filter (where rn = (c + 1) / 2)
              else (max(x) filter (where rn = c / 2) + max(x) filter (where rn = c / 2 + 1)) / 2
         end
    from v;
$$;

-- Round to a step (JS Math.round semantics), then clamp.
create or replace function public._drop_shape(p_x float8, p_step float8, p_lo float8, p_hi float8)
returns integer
language sql
immutable
as $$
  select least(p_hi, greatest(p_lo, floor(p_x / p_step + 0.5) * p_step))::integer;
$$;

-- Today's target from the last 14 days (oldest first, yesterday last): a port
-- of autoTarget in lib/drop.ts. Under 5 known days → the starter target.
-- Otherwise the typical day (median) stretched, eased back to typical after a
-- big yesterday, and asked at a share of typical on a comeback. Float8 all the
-- way, so the arithmetic matches JavaScript's.
create or replace function public._drop_target(
  p_steps integer[],
  p_minutes integer[],
  p_comeback boolean default false,
  out steps integer,
  out minutes integer,
  out basis text,
  out typical_steps integer,
  out typical_minutes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n        integer := coalesce(array_length(p_steps, 1), 0);
  ks       float8[] := '{}';
  am       float8[] := '{}';
  i        integer;
  typ_s    float8;
  typ_m    float8;
  y_s      float8;
  y_m      float8;
  st_s     float8 := public._drop_num('drop_starter_steps', 6000)::float8;
  st_m     float8 := public._drop_num('drop_starter_minutes', 20)::float8;
  stretch  float8 := public._drop_num('drop_stretch', 1.1)::float8;
  s_lo     float8 := public._drop_num('drop_steps_floor', 4000)::float8;
  s_hi     float8 := public._drop_num('drop_steps_ceiling', 15000)::float8;
  m_lo     float8 := public._drop_num('drop_minutes_floor', 15)::float8;
  m_hi     float8 := public._drop_num('drop_minutes_ceiling', 60)::float8;
  share    float8 := public._drop_num('drop_comeback_share', 0.7)::float8;
  u_s      integer;
  u_m      integer;
  e_s      integer;
  e_m      integer;
begin
  for i in greatest(1, n - 13)..n loop
    if coalesce(p_steps[i], 0) > 0 or coalesce(p_minutes[i], 0) > 0 then
      ks := ks || coalesce(p_steps[i], 0)::float8;
      if coalesce(p_minutes[i], 0) > 0 then
        am := am || p_minutes[i]::float8;
      end if;
    end if;
  end loop;

  if coalesce(array_length(ks, 1), 0) < 5 then
    steps := st_s::integer;
    minutes := st_m::integer;
    basis := 'starter';
    typical_steps := 0;
    typical_minutes := 0;
    return;
  end if;

  typ_s := public._drop_median(ks);
  typ_m := case when coalesce(array_length(am, 1), 0) > 0 then public._drop_median(am) else st_m end;
  typical_steps := round(typ_s)::integer;
  typical_minutes := round(typ_m)::integer;

  if p_comeback then
    steps := public._drop_shape(typ_s * share, 500, s_lo, s_hi);
    minutes := public._drop_shape(typ_m * share, 5, m_lo, m_hi);
    basis := 'comeback';
    return;
  end if;

  y_s := coalesce(p_steps[n], 0);
  y_m := coalesce(p_minutes[n], 0);
  u_s := public._drop_shape(typ_s * stretch, 500, s_lo, s_hi);
  u_m := public._drop_shape(typ_m + 5, 5, m_lo, m_hi);

  if (typ_s > 0 and y_s > typ_s * 1.5) or (typ_m > 0 and y_m > typ_m * 1.5) then
    e_s := public._drop_shape(typ_s, 500, s_lo, s_hi);
    e_m := public._drop_shape(typ_m, 5, m_lo, m_hi);
    -- Only a rest day when it really is lower on a route they use.
    if e_s < u_s or (coalesce(array_length(am, 1), 0) > 0 and e_m < u_m) then
      steps := e_s;
      minutes := e_m;
      basis := 'recovery';
      return;
    end if;
  end if;

  steps := u_s;
  minutes := u_m;
  basis := 'history';
end;
$$;

-- Today's row, made the first time it's asked for, its target frozen then.
create or replace function public._drop_make_day(p_uid uuid, p_tz text, p_day date)
returns public.drop_days
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s    integer[];
  v_m    integer[];
  v_last date;
  v_away integer;
  v_cb   boolean;
  t      record;
  r      public.drop_days;
begin
  select * into r from public.drop_days where user_id = p_uid and day = p_day;
  if found then
    return r;
  end if;

  select array_agg(m.steps order by m.d), array_agg(m.minutes order by m.d)
    into v_s, v_m
    from public._drop_movement(p_uid, p_tz, p_day - 14, p_day - 1) m;

  select max(m.d) into v_last
    from public._drop_movement(p_uid, p_tz, p_day - 90, p_day - 1) m
   where m.steps > 0 or m.minutes > 0;
  v_away := case when v_last is null then null else p_day - v_last end;
  v_cb := v_away is not null and v_away >= public._drop_num('drop_comeback_after_days', 3);

  select * into t from public._drop_target(v_s, v_m, v_cb);

  insert into public.drop_days
    (user_id, day, tz, target_steps, target_minutes, basis, typical_steps, typical_minutes, comeback, days_away)
  values
    (p_uid, p_day, p_tz, t.steps, t.minutes, t.basis, t.typical_steps, t.typical_minutes, v_cb, v_away)
  on conflict (user_id, day) do nothing;

  select * into r from public.drop_days where user_id = p_uid and day = p_day;
  return r;
end;
$$;

-- A partner code can go to this member: the reward is live, they don't already
-- hold an active one, and the brand's per-person limit holds.
create or replace function public._drop_partner_ok(p_uid uuid, p_reward_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rewards rw
     where rw.id = p_reward_id
       and rw.active
       and coalesce(rw.integration_type::text, '') <> 'AFFILIATE'
       and not exists (
         select 1 from public.redemptions d
          where d.user_id = p_uid and d.reward_id = rw.id
            and d.status::text = 'active' and (d.expires_at is null or d.expires_at >= now()))
       and (rw.max_redemptions_per_user is null
            or (select count(*) from public.redemptions d
                 where d.user_id = p_uid and d.reward_id = rw.id
                   and d.status::text <> 'refunded') < rw.max_redemptions_per_user)
  );
$$;

-- POWR (now + Vault) all Drops have paid on a London day.
create or replace function public._drop_spent(p_day date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(prize_amount), 0)::integer
    from public.drop_days
   where status = 'opened'
     and prize_kind in ('points', 'vault')
     and (opened_at at time zone 'Europe/London')::date = p_day;
$$;

-- Pay one prize to the member. Returns what it wrote, or null when it can't
-- pay (a partner pool ran dry, the member already holds that code).
create or replace function public._drop_give(p_uid uuid, p public.drop_prizes)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims   text;
  v_tx       uuid;
  v_dep      uuid;
  v_vest     integer;
  v_vests    timestamptz;
  v_reward   public.rewards;
  v_brand    public.partners;
  v_shared   text;
  v_expires  timestamptz;
  v_code     text;
  v_code_id  uuid;
  v_checkout text;
  v_red      uuid;
begin
  if p.kind = 'points' then
    -- Service-role claim for the cap trigger, as the attendance award does.
    v_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims',
      (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
         || jsonb_build_object('role', 'service_role'))::text, true);
    insert into public.point_transactions (user_id, amount, type, source, description)
    values (p_uid, p.amount, 'bonus', 'drop', 'POWR Drop')
    returning id into v_tx;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    return jsonb_build_object('point_tx_id', v_tx, 'detail', '{}'::jsonb);
  end if;

  if p.kind = 'vault' then
    select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 60)
      into v_vest from public.system_config where key = 'vault_vest_days';
    if v_vest is null or v_vest <= 0 then
      v_vest := 60;
    end if;
    v_vests := now() + make_interval(days => v_vest);
    insert into public.vault_deposits (user_id, amount, source, description, vests_at)
    values (p_uid, p.amount, 'drop', 'POWR Drop', v_vests)
    returning id into v_dep;
    return jsonb_build_object('vault_deposit_id', v_dep,
                              'detail', jsonb_build_object('vest_days', v_vest, 'vests_at', v_vests));
  end if;

  -- Partner: the code lands in the Wallet as live events issue them.
  if not public._drop_partner_ok(p_uid, p.reward_id) then
    return null;
  end if;
  select * into v_reward from public.rewards where id = p.reward_id;
  select * into v_brand from public.partners where id = v_reward.partner_id;
  v_shared  := nullif(btrim(coalesce(v_reward.promo_code, '')), '');
  v_expires := now() + make_interval(days => coalesce(v_reward.code_expiry_days, 30));
  if v_shared is not null then
    v_code := v_shared;
  else
    select c.id, c.code into v_code_id, v_code
      from public.claim_pool_code(v_reward.id, p_uid, v_expires) c;
    if v_code is null then
      return null;
    end if;
  end if;
  v_checkout := case when v_brand.checkout_url_template is not null
                     then replace(v_brand.checkout_url_template, '{code}', v_code)
                     else v_reward.url end;

  -- Marked as emailed on the way in: the reveal and the Wallet show it.
  insert into public.redemptions
    (user_id, reward_id, code_id, code, integration_type, powr_spent, status, expires_at, checkout_url,
     reward_title, partner_name, reward_image_url, reward_hero_image_url, receipt_emailed_at)
  values
    (p_uid, v_reward.id, v_code_id, v_code, v_reward.integration_type::text, 0, 'active', v_expires, v_checkout,
     v_reward.title, coalesce(v_brand.name, v_reward.brand_name), coalesce(v_reward.image_url, v_brand.logo_url),
     v_reward.hero_image_url, now())
  returning id into v_red;

  if v_code_id is not null and v_reward.brand_name is not null
     and exists (select 1 from public.reward_brand_webhook_endpoints w
                  where lower(w.brand_name) = lower(v_reward.brand_name) and w.active) then
    perform public.enqueue_brand_webhook(v_reward.brand_name, 'code.assigned', jsonb_build_object(
      'brand_name',   v_reward.brand_name,
      'reward_id',    v_reward.id,
      'reward_title', v_reward.title,
      'code_id',      v_code_id,
      'code',         v_code,
      'assigned_at',  now(),
      'expires_at',   v_expires,
      'source',       'drop'));
  end if;

  return jsonb_build_object(
    'redemption_id', v_red,
    'reward_id', v_reward.id,
    'detail', jsonb_build_object(
      'brand',       coalesce(v_brand.name, v_reward.brand_name),
      'title',       v_reward.title,
      'value_label', v_reward.value_label,
      'image_url',   coalesce(v_reward.image_url, v_brand.logo_url),
      'expires_at',  v_expires));
end;
$$;

-- Roll and pay a day's prize. The caller holds the day row's lock and the
-- open lock. p_force pays that prize (support reissue); otherwise a weighted
-- roll over the daily pool — leaving out what is off, out of date, out of
-- stock, over the budget, or a code the member can't take — then, when
-- nothing there can pay, the fallback pool. Returns the prize, or null.
create or replace function public._drop_pay(p_day_id uuid, p_force uuid default null, p_ignore_budget boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.drop_days;
  p        public.drop_prizes;
  v_budget numeric := public._drop_num('drop_daily_budget', 1000);
  v_spent  integer := public._drop_spent((now() at time zone 'Europe/London')::date);
  v_vault  boolean;
  v_pool   text;
  v_ids    uuid[];
  v_w      integer[];
  v_tried  uuid[] := '{}';
  v_total  integer;
  v_roll   float8;
  v_acc    integer;
  v_pick   uuid;
  v_paid   jsonb;
  i        integer;
begin
  select * into r from public.drop_days where id = p_day_id;
  begin
    v_vault := public.vault_has_access(r.user_id);
  exception when others then
    v_vault := true;
  end;

  foreach v_pool in array case when p_force is not null then array['forced'] else array['daily', 'fallback'] end
  loop
    loop
      if v_pool = 'forced' then
        exit when p_force = any (v_tried);
        v_ids := array[p_force];
        v_w := array[1];
      else
        select array_agg(x.id order by x.id), array_agg(x.weight order by x.id)
          into v_ids, v_w
          from public.drop_prizes x
         where x.pool = v_pool
           and x.active
           and (x.starts_at is null or x.starts_at <= now())
           and (x.ends_at is null or x.ends_at > now())
           and (x.stock is null or x.given < x.stock)
           and not (x.id = any (v_tried))
           and (x.kind <> 'vault' or v_vault)
           and (x.kind = 'partner' or v_pool = 'fallback' or p_ignore_budget or v_spent + x.amount <= v_budget)
           and (x.kind <> 'partner' or public._drop_partner_ok(r.user_id, x.reward_id));
        exit when v_ids is null;
      end if;

      select sum(w) into v_total from unnest(v_w) w;
      v_roll := random() * v_total;
      v_acc := 0;
      v_pick := v_ids[array_length(v_ids, 1)];
      for i in 1..array_length(v_ids, 1) loop
        v_acc := v_acc + v_w[i];
        if v_roll < v_acc then
          v_pick := v_ids[i];
          exit;
        end if;
      end loop;
      v_tried := v_tried || v_pick;

      select * into p from public.drop_prizes where id = v_pick for update;
      continue when not found or (p.stock is not null and p.given >= p.stock);
      v_paid := public._drop_give(r.user_id, p);
      continue when v_paid is null;

      update public.drop_prizes set given = given + 1 where id = p.id;
      update public.drop_days
         set status = 'opened',
             opened_at = now(),
             prize_id = p.id,
             prize_kind = p.kind,
             prize_amount = p.amount,
             prize_detail = v_paid->'detail',
             fallback = (v_pool = 'fallback'),
             reward_id = (v_paid->>'reward_id')::uuid,
             point_tx_id = (v_paid->>'point_tx_id')::uuid,
             vault_deposit_id = (v_paid->>'vault_deposit_id')::uuid,
             redemption_id = (v_paid->>'redemption_id')::uuid
       where id = r.id;
      return jsonb_build_object('kind', p.kind, 'amount', p.amount, 'fallback', v_pool = 'fallback')
             || coalesce(v_paid->'detail', '{}'::jsonb);
    end loop;
  end loop;
  return null;
end;
$$;

-- What the app shows for an opened day.
create or replace function public._drop_prize_json(r public.drop_days)
returns jsonb
language sql
stable
as $$
  select case when r.status = 'opened' and r.prize_kind is not null
              then jsonb_build_object('kind', r.prize_kind, 'amount', r.prize_amount, 'fallback', r.fallback)
                   || coalesce(r.prize_detail, '{}'::jsonb)
         end;
$$;

-- ── 4. The app ──────────────────────────────────────────────────────────────

-- Today's Drop for the signed-in member, or null when it's off for them.
-- Makes today's row on first ask. Steps and minutes are the server's own
-- count, so call it after the app's step sync.
create or replace function public.get_my_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_today  date;
  r        public.drop_days;
  v_steps  integer;
  v_mins   integer;
  v_monday date;
  v_first  date;
  v_week   jsonb;
  v_inside jsonb;
begin
  if not coalesce(public._drop_enabled_for(v_uid), false) then
    return null;
  end if;
  v_tz := public._drop_tz(v_uid);
  v_today := (now() at time zone v_tz)::date;
  r := public._drop_make_day(v_uid, v_tz, v_today);

  select m.steps, m.minutes into v_steps, v_mins
    from public._drop_movement(v_uid, v_tz, v_today, v_today) m;

  -- Monday to yesterday: opened, missed, or none (before their first Drop).
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  select min(day) into v_first from public.drop_days where user_id = v_uid;
  select coalesce(jsonb_agg(
           case when dd.status = 'opened' then 'opened'
                when g.d < v_first then 'none'
                else 'missed' end
           order by g.d), '[]'::jsonb)
    into v_week
    from (select gs::date as d
            from generate_series(v_monday::timestamp, (v_today - 1)::timestamp, interval '1 day') gs) g
    left join public.drop_days dd on dd.user_id = v_uid and dd.day = g.d;

  -- What could be inside: the live daily prizes, best odds first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind, 'amount', x.amount, 'brand', x.brand, 'value_label', x.value_label, 'title', x.title)
           order by x.weight desc), '[]'::jsonb)
    into v_inside
    from (
      select * from (
        select distinct on (p.kind, p.amount, p.reward_id)
               p.kind, p.amount, p.weight, coalesce(pa.name, rw.brand_name) as brand, rw.value_label, rw.title
          from public.drop_prizes p
          left join public.rewards rw on rw.id = p.reward_id
          left join public.partners pa on pa.id = rw.partner_id
         where p.pool = 'daily'
           and p.active
           and (p.starts_at is null or p.starts_at <= now())
           and (p.ends_at is null or p.ends_at > now())
           and (p.stock is null or p.given < p.stock)
           and (p.kind <> 'partner' or (rw.active and coalesce(rw.integration_type::text, '') <> 'AFFILIATE'))
         order by p.kind, p.amount, p.reward_id, p.weight desc
      ) d
      order by d.weight desc
      limit 4
    ) x;

  return jsonb_build_object(
    'day',             v_today,
    'status',          r.status,
    'target',          jsonb_build_object('steps', r.target_steps, 'minutes', r.target_minutes, 'basis', r.basis,
                                          'typical_steps', r.typical_steps, 'typical_minutes', r.typical_minutes),
    'steps',           coalesce(v_steps, 0),
    'minutes',         coalesce(v_mins, 0),
    'prize',           public._drop_prize_json(r),
    'opened_at',       r.opened_at,
    'week',            v_week,
    'day_index',       extract(isodow from v_today)::integer - 1,
    'comeback',        case when r.comeback then jsonb_build_object('days_away', r.days_away) end,
    'could_be_inside', v_inside,
    'resets_at',       (v_today + 1)::timestamp at time zone v_tz
  );
end;
$$;

-- Open today's Drop. Safe to retry: an opened day returns the same prize.
-- { ok: true, prize, already } or { ok: false, reason: off | void | not_yet | empty }.
create or replace function public.open_my_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_tz    text;
  v_today date;
  r       public.drop_days;
  v_steps integer;
  v_mins  integer;
  v_prize jsonb;
begin
  if not coalesce(public._drop_enabled_for(v_uid), false) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  v_tz := public._drop_tz(v_uid);
  v_today := (now() at time zone v_tz)::date;
  perform public._drop_make_day(v_uid, v_tz, v_today);
  select * into r from public.drop_days where user_id = v_uid and day = v_today for update;

  if r.status = 'opened' then
    return jsonb_build_object('ok', true, 'already', true, 'prize', public._drop_prize_json(r));
  end if;
  if r.status = 'void' then
    return jsonb_build_object('ok', false, 'reason', 'void');
  end if;

  select m.steps, m.minutes into v_steps, v_mins
    from public._drop_movement(v_uid, v_tz, v_today, v_today) m;
  if coalesce(v_steps, 0) < r.target_steps and coalesce(v_mins, 0) < r.target_minutes then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'steps', coalesce(v_steps, 0), 'minutes', coalesce(v_mins, 0));
  end if;

  update public.drop_days set steps_at_open = coalesce(v_steps, 0), minutes_at_open = coalesce(v_mins, 0)
   where id = r.id;

  -- One open at a time across everyone, so the budget and stock hold exactly.
  perform pg_advisory_xact_lock(hashtext('powr_drop_open'));
  v_prize := public._drop_pay(r.id);
  if v_prize is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'prize', v_prize);
end;
$$;

-- ── 5. Admin ────────────────────────────────────────────────────────────────

-- The Opens panel: a day's numbers (London day), its opens, and the last 14 days.
create or replace function public.admin_drop_overview(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Europe/London')::date);
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'day',      v_day,
    'budget',   public._drop_num('drop_daily_budget', 1000),
    'spent',    public._drop_spent(v_day),
    'members',  (select count(*) from public.drop_days where day = v_day),
    'opened',   (select count(*) from public.drop_days where day = v_day and status = 'opened'),
    'void',     (select count(*) from public.drop_days where day = v_day and status = 'void'),
    'by_prize', (select coalesce(jsonb_agg(jsonb_build_object(
                    'prize_id', b.prize_id, 'kind', b.prize_kind, 'amount', b.prize_amount,
                    'brand', b.brand, 'count', b.n, 'fallback', b.fallback) order by b.n desc), '[]'::jsonb)
                   from (select prize_id, prize_kind, prize_amount, bool_or(fallback) as fallback,
                                max(prize_detail->>'brand') as brand, count(*) as n
                           from public.drop_days
                          where day = v_day and status = 'opened'
                          group by prize_id, prize_kind, prize_amount) b),
    'opens',    (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', d.id, 'user_id', d.user_id, 'username', pr.username, 'display_name', pr.display_name,
                    'day', d.day, 'status', d.status, 'opened_at', d.opened_at,
                    'target_steps', d.target_steps, 'target_minutes', d.target_minutes, 'basis', d.basis,
                    'typical_steps', d.typical_steps, 'steps_at_open', d.steps_at_open,
                    'minutes_at_open', d.minutes_at_open,
                    'prize', public._drop_prize_json(d), 'prize_kind', d.prize_kind, 'prize_amount', d.prize_amount,
                    'fallback', d.fallback, 'void_reason', d.void_reason, 'reissue_reason', d.reissue_reason,
                    'flagged', d.typical_steps > 0 and coalesce(d.steps_at_open, 0) > 3 * d.typical_steps)
                    order by coalesce(d.opened_at, d.voided_at) desc), '[]'::jsonb)
                   from public.drop_days d
                   left join public.profiles pr on pr.id = d.user_id
                  where d.day = v_day and d.status <> 'sealed'),
    'last14',   (select coalesce(jsonb_agg(jsonb_build_object(
                    'day', g.d,
                    'members', (select count(*) from public.drop_days x where x.day = g.d),
                    'opened', (select count(*) from public.drop_days x where x.day = g.d and x.status = 'opened'),
                    'powr', public._drop_spent(g.d)) order by g.d), '[]'::jsonb)
                   from (select gs::date as d
                           from generate_series((v_day - 13)::timestamp, v_day::timestamp, interval '1 day') gs) g)
  );
end;
$$;

-- Find a member by username, display name or email, with their last 30 days.
create or replace function public.admin_drop_lookup(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  q text := btrim(coalesce(p_query, ''));
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if length(q) < 2 then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', m.id, 'username', m.username, 'display_name', m.display_name, 'email', m.email,
             'enabled', public._drop_enabled_for(m.id),
             'days', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', d.id, 'day', d.day, 'status', d.status, 'opened_at', d.opened_at,
                        'target_steps', d.target_steps, 'target_minutes', d.target_minutes, 'basis', d.basis,
                        'typical_steps', d.typical_steps, 'steps_at_open', d.steps_at_open,
                        'minutes_at_open', d.minutes_at_open, 'prize', public._drop_prize_json(d),
                        'prize_kind', d.prize_kind, 'prize_amount', d.prize_amount, 'prize_detail', d.prize_detail,
                        'fallback', d.fallback, 'void_reason', d.void_reason, 'void_detail', d.void_detail,
                        'reissue_reason', d.reissue_reason) order by d.day desc), '[]'::jsonb)
                        from (select * from public.drop_days
                               where user_id = m.id order by day desc limit 30) d)
           )), '[]'::jsonb)
      from (
        select p.id, p.username, p.display_name, u.email
          from public.profiles p
          left join auth.users u on u.id = p.id
         where p.username ilike '%' || q || '%'
            or p.display_name ilike '%' || q || '%'
            or u.email ilike '%' || q || '%'
         order by p.username nulls last
         limit 10
      ) m
  );
end;
$$;

-- Void an opened Drop: takes back what can be taken back and records the rest.
-- POWR now comes back up to the member's current balance, as a negative bonus
-- row (so leaderboards and today's earned never see it); an unreleased Vault
-- deposit is removed; an active partner code is expired.
create or replace function public.admin_void_drop(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.drop_days;
  v_claims text;
  v_bal    integer;
  v_take   integer;
  v_detail jsonb := '{}'::jsonb;
  v_n      integer;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is needed (3 characters or more)';
  end if;
  select * into r from public.drop_days where id = p_id for update;
  if not found then
    raise exception 'No such Drop';
  end if;
  if r.status <> 'opened' then
    raise exception 'Only an opened Drop can be voided (this one is %)', r.status;
  end if;

  if r.prize_kind = 'points' then
    select coalesce(sum(amount), 0)::integer into v_bal from public.point_transactions where user_id = r.user_id;
    v_take := least(r.prize_amount, greatest(v_bal, 0));
    if v_take > 0 then
      v_claims := current_setting('request.jwt.claims', true);
      perform set_config('request.jwt.claims',
        (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
           || jsonb_build_object('role', 'service_role'))::text, true);
      insert into public.point_transactions (user_id, amount, type, source, description)
      values (r.user_id, -v_take, 'bonus', 'drop_void', 'POWR Drop taken back');
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    end if;
    v_detail := jsonb_build_object('took_back', v_take, 'kept', r.prize_amount - v_take);
  elsif r.prize_kind = 'vault' then
    delete from public.vault_deposits where id = r.vault_deposit_id and released_at is null;
    get diagnostics v_n = row_count;
    v_detail := jsonb_build_object('vault', case when v_n > 0 then 'removed' else 'already released' end);
  elsif r.prize_kind = 'partner' then
    update public.redemptions set status = 'expired' where id = r.redemption_id and status::text = 'active';
    get diagnostics v_n = row_count;
    v_detail := jsonb_build_object('code', case when v_n > 0 then 'expired' else 'already used or gone' end);
  end if;

  update public.drop_days
     set status = 'void', void_reason = btrim(p_reason), void_detail = v_detail,
         voided_by = auth.uid(), voided_at = now()
   where id = r.id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'drop_void', 'drop_day', r.id::text,
          jsonb_build_object('user_id', r.user_id, 'day', r.day, 'prize_kind', r.prize_kind,
                             'prize_amount', r.prize_amount, 'reason', btrim(p_reason)) || v_detail);
  return v_detail;
end;
$$;

-- Give a sealed or voided Drop a prize: a chosen one (p_prize), or a fresh
-- roll. Past the budget either way — it's a support call, logged with a reason.
create or replace function public.admin_reissue_drop(p_id uuid, p_prize uuid default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.drop_days;
  v_prize jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is needed (3 characters or more)';
  end if;
  select * into r from public.drop_days where id = p_id for update;
  if not found then
    raise exception 'No such Drop';
  end if;
  if r.status = 'opened' then
    raise exception 'This Drop is already open: void it first';
  end if;
  if p_prize is not null and not exists (select 1 from public.drop_prizes where id = p_prize) then
    raise exception 'No such prize';
  end if;

  perform pg_advisory_xact_lock(hashtext('powr_drop_open'));
  v_prize := public._drop_pay(r.id, p_prize, true);
  if v_prize is null then
    raise exception 'That prize can''t be paid to this member (out of stock, or they already hold that code)';
  end if;

  update public.drop_days
     set reissue_reason = btrim(p_reason), reissued_by = auth.uid(), reissued_at = now()
   where id = r.id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'drop_reissue', 'drop_day', r.id::text,
          jsonb_build_object('user_id', r.user_id, 'day', r.day, 'chosen_prize', p_prize,
                             'reason', btrim(p_reason), 'prize', v_prize));
  return v_prize;
end;
$$;

-- ── 6. Live events never count a Drop ───────────────────────────────────────
-- A Drop is luck, not effort: its rows ('drop', and 'drop_void' reversals) are
-- 'never_counts', like the attendance reward, even on an event that counts
-- bonuses. Re-stated from prod (pg_get_functiondef, 2026-10-26, identical to
-- 20260924200000); the only change is the 'drop' line in the reason case.
create or replace function public._live_event_ledger(p_event_id uuid, p_uid uuid default null::uuid)
returns table(tx_id uuid, user_id uuid, amount integer, tx_type text, source text, description text, created_at timestamp with time zone, session_id uuid, activity text, verification text, started_at timestamp with time zone, ended_at timestamp with time zone, bucket text, counted boolean, counted_at timestamp with time zone, reason text)
language sql
stable security definer
set search_path to 'public'
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  rows as (
    select pt.id                              as tx_id,
           pt.user_id,
           pt.amount,
           pt.type::text                      as tx_type,
           pt.source,
           pt.description,
           pt.created_at,
           s.id                               as session_id,
           s.type::text                       as s_type,
           s.verification::text               as s_verif,
           s.partner_id                       as s_partner,
           s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at
    from public.point_transactions pt
    cross join ev
    left join public.activity_sessions s on s.id = pt.session_id
    where (p_uid is null or pt.user_id = p_uid)
      and pt.type::text <> 'redeem'
      and (
        (pt.created_at >= ev.window_start_at and pt.created_at < ev.window_end_at)
        or (s.id is not null
            and coalesce(s.ended_at, s.started_at) > ev.window_start_at
            and s.started_at                       < ev.window_end_at)
      )
  ),
  sess as (
    -- session-backed: in the window when the ACTIVITY overlaps it.
    -- "manual" = the session's verification, never the ledger source
    -- (native HealthKit rows are source = 'manual_log').
    select r.*,
           case when r.tx_type = 'streak' then 'streak'
                when r.tx_type = 'earn'   then 'activity'
                else r.tx_type end as bucket,
           case
             when not (r.ended_at > ev.window_start_at and r.started_at < ev.window_end_at)
                                                                              then 'outside_window'
             when r.tx_type = 'streak' and not ev.count_streak                then 'streak_off'
             when r.tx_type = 'streak'                                        then null
             when r.tx_type <> 'earn'                                         then 'type_not_scored'
             when not ev.count_manual  and coalesce(r.s_verif, '') = 'manual' then 'manual_off'
             when not ev.count_walking and coalesce(r.s_type, '')  = 'walking' then 'walking_off'
             when ev.included_activities is not null
                  and not (r.s_type = any (ev.included_activities))           then 'activity_not_included'
             when ev.count_venue_only
                  and r.s_partner is distinct from ev.venue_partner_id        then 'not_at_venue'
             else null
           end as reason
    from rows r
    cross join ev
    where r.session_id is not null
  ),
  other as (
    -- sessionless rows credited in the window. Which ones count is the
    -- event's choice, with two fixed rules the editor promises: penalties
    -- always reduce a score; the attendance reward never adds to one.
    -- Invite rewards (both sides of a conversion + the milestone) are a
    -- switch like the others — count_referrals — and need no anchor: they
    -- are paid at the moment the friend converts, so an in-window row IS
    -- in-window effort, never a backfill. Sessionless earn / streak rows
    -- ride on in-window activity the member had already banked (a counted
    -- session row credited at or before them).
    select r.*,
           case
             when r.tx_type = 'penalty'    then 'penalty'
             when r.tx_type = 'adjustment' then 'adjustment'
             when coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
                                           then 'challenge'
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone')
                                           then 'invite'
             when coalesce(r.source, '') = 'event_attendance'
                                           then 'attendance'
             when r.tx_type = 'bonus'      then 'bonus'
             when r.tx_type = 'streak'     then 'streak'
             else 'other'
           end as bucket,
           case
             when coalesce(r.source, '') = 'event_attendance'                 then 'never_counts'
             when coalesce(r.source, '') in ('drop', 'drop_void')             then 'never_counts'
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone')
                  then case when ev.count_referrals then null else 'referrals_off' end
             when r.tx_type = 'penalty'                                       then null
             when r.tx_type = 'adjustment'
                  then case when ev.count_adjustments then null else 'adjustments_off' end
             when coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
                  then case when ev.count_challenges then null else 'challenges_off' end
             when r.tx_type = 'bonus'
                  then case when ev.count_bonuses then null else 'bonuses_off' end
             when r.tx_type = 'streak' and not ev.count_streak                then 'streak_off'
             when r.tx_type in ('earn', 'streak')
                  then case when exists (
                         select 1 from sess x
                         where x.user_id = r.user_id
                           and x.reason is null
                           and x.created_at <= r.created_at
                       ) then null else 'no_anchor' end
             else 'type_not_scored'
           end as reason
    from rows r
    cross join ev
    where r.session_id is null
  )
  select s.tx_id, s.user_id, s.amount, s.tx_type, s.source, s.description, s.created_at,
         s.session_id, s.s_type, s.s_verif, s.started_at, s.ended_at,
         s.bucket, (s.reason is null),
         case when s.reason is null then s.ended_at end, s.reason
  from sess s
  union all
  select o.tx_id, o.user_id, o.amount, o.tx_type, o.source, o.description, o.created_at,
         o.session_id, o.s_type, o.s_verif, o.started_at, o.ended_at,
         o.bucket, (o.reason is null),
         case when o.reason is null then o.created_at end, o.reason
  from other o
$$;

-- ── 7. Grants ───────────────────────────────────────────────────────────────

revoke all on function public._drop_num(text, numeric) from public, anon, authenticated;
revoke all on function public._drop_ts(text) from public, anon, authenticated;
revoke all on function public._drop_is_demo(uuid) from public, anon, authenticated;
revoke all on function public._drop_enabled_for(uuid) from public, anon, authenticated;
revoke all on function public._drop_tz(uuid) from public, anon, authenticated;
revoke all on function public._drop_movement(uuid, text, date, date) from public, anon, authenticated;
revoke all on function public._drop_median(float8[]) from public, anon, authenticated;
revoke all on function public._drop_shape(float8, float8, float8, float8) from public, anon, authenticated;
revoke all on function public._drop_target(integer[], integer[], boolean) from public, anon, authenticated;
revoke all on function public._drop_make_day(uuid, text, date) from public, anon, authenticated;
revoke all on function public._drop_partner_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public._drop_spent(date) from public, anon, authenticated;
revoke all on function public._drop_give(uuid, public.drop_prizes) from public, anon, authenticated;
revoke all on function public._drop_pay(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public._drop_prize_json(public.drop_days) from public, anon, authenticated;

revoke all on function public.get_my_drop() from public, anon;
revoke all on function public.open_my_drop() from public, anon;
revoke all on function public.admin_drop_overview(date) from public, anon;
revoke all on function public.admin_drop_lookup(text) from public, anon;
revoke all on function public.admin_void_drop(uuid, text) from public, anon;
revoke all on function public.admin_reissue_drop(uuid, uuid, text) from public, anon;
grant execute on function public.get_my_drop() to authenticated;
grant execute on function public.open_my_drop() to authenticated;
grant execute on function public.admin_drop_overview(date) to authenticated;
grant execute on function public.admin_drop_lookup(text) to authenticated;
grant execute on function public.admin_void_drop(uuid, text) to authenticated;
grant execute on function public.admin_reissue_drop(uuid, uuid, text) to authenticated;
