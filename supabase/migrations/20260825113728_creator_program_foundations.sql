-- =============================================================
-- CREATOR PROGRAM — P0 FOUNDATIONS
-- =============================================================
-- Spec: docs/creator-program-scope.md
--
-- Inbound creator program: coaches, athletes, gym owners hand out
-- a tracked link/code, drive installs, and earn points + physical
-- product for signups that CONVERT.
--
-- Three deliberate choices, all Jamie's, 2026-08-25:
--
--   * "Creator", never "affiliate". `rewards.integration_type`
--     already has an AFFILIATE value meaning the OPPOSITE thing
--     (a brand checkout URL we send members OUT to). Nothing here
--     borrows that word.
--
--   * Payout is points + PHYSICAL PRODUCT. No cash, no Stripe, no
--     KYC. A milestone therefore creates an owed record that an
--     admin approves — points are reversible, hoodies are not.
--
--   * Invite-only. There is no public application form; admins
--     mint tokenised setup links, exactly like the brand portal.
--
-- This migration reuses the invite-conversion engine rather than
-- forking it. `referrals` has 0 rows in production, so widening
-- it costs nothing and carries no backfill.
-- =============================================================


-- =============================================================
-- 1. The creator
-- =============================================================
-- Two user links, and they are NOT the same thing:
--
--   creator_users.user_id  — who can log into the /creator portal.
--                            May be a fresh auth user who has never
--                            opened the app.
--   creators.member_user_id — their POWR app account, if they have
--                            one. Only used to credit points and to
--                            block self-referral.
--
-- A creator with no member_user_id still earns; the points sit in
-- creator_earnings until they link an account.

create table if not exists public.creators (
  id              uuid primary key default gen_random_uuid(),

  -- powr.life/join/<handle>. Lowercase, url-safe, stable — it goes
  -- in bios and on printed cards, so renaming is a support event.
  handle          text not null unique
                    check (handle ~ '^[a-z0-9][a-z0-9-]{1,29}$'),

  -- The vanity code they hand out. Stored uppercase.
  --
  -- The 6..10 bound is NOT cosmetic: context/AuthContext.tsx
  -- captures deep-link codes with /[?&]ref=([A-Z0-9]{6,10})/i, so
  -- a 5-char code would be silently dropped by every already-
  -- shipped client. Widening this REQUIRES that regex to ship
  -- first (P3, OTA-able). Until then, 6..10.
  code            text not null unique
                    check (code ~ '^[A-Z0-9]{6,10}$'),

  display_name    text not null,
  avatar_url      text,
  bio             text,

  member_user_id  uuid references public.profiles(id) on delete set null,

  status          text not null default 'active'
                    check (status in ('active','paused','terminated')),

  -- Per-creator override of the platform default. Null = default.
  conversion_points integer check (conversion_points is null or conversion_points >= 0),

  -- Where the physical product goes. This is the FIRST postal address POWR
  -- stores, so: creator-owned (they edit it), admin-readable (someone has to
  -- pack the box), and readable by nobody else — enforced in RLS below, not in
  -- a client-side filter. It needs a line in the privacy policy before the
  -- first shipment goes out.
  shipping_name    text,
  shipping_address jsonb,

  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  paused_at       timestamptz,
  notes           text
);

comment on table public.creators is
  'Inbound creator/affiliate partners. creators.code is a VANITY ALIAS resolved ahead of profiles.referral_code — it is not a second member identifier; profiles.referral_code remains the one POWR ID.';

comment on column public.creators.code is
  'Uppercase vanity code. Bound to 6..10 chars because AuthContext deep-link capture uses [A-Z0-9]{6,10}; widening needs that client regex shipped first.';

comment on column public.creators.member_user_id is
  'Their POWR app account, if any. Used to credit points and block self-referral. NOT the portal login — see creator_users.';

create index if not exists idx_creators_member_user on public.creators (member_user_id)
  where member_user_id is not null;

create index if not exists idx_creators_status on public.creators (status);


-- =============================================================
-- 2. Portal access — mirrors reward_brand_users / _invites
-- =============================================================
-- The token IS the credential (see manage-partner-user): validate,
-- redeem (creates the auth user + link, burns the token), revoke.

create table if not exists public.creator_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  creator_id  uuid not null references public.creators(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_creator_users_creator on public.creator_users (creator_id);

create table if not exists public.creator_invites (
  id           uuid primary key default gen_random_uuid(),
  invite_token uuid not null unique,
  creator_id   uuid not null references public.creators(id) on delete cascade,
  email        text,
  status       text not null default 'invited'
                 check (status in ('invited','used','revoked')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  used_at      timestamptz,
  used_by      uuid references auth.users(id) on delete set null
);

create index if not exists idx_creator_invites_creator on public.creator_invites (creator_id);


-- =============================================================
-- 3. Clicks
-- =============================================================
-- Logged server-side by the creator-link edge function. The point
-- of this table is to make the attribution LEAK measurable: iOS has
-- no reliable deferred deep link, so clicks-vs-conversions is the
-- only honest way to decide whether to buy Branch later.
--
-- No raw IP is ever stored — only a salted hash, and only to spot
-- farming clusters.

create table if not exists public.creator_clicks (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.creators(id) on delete cascade,
  created_at   timestamptz not null default now(),
  platform     text check (platform in ('ios','android','other')),
  source       text,
  campaign     text,
  referer_host text,
  ip_hash      text,
  ua_family    text
);

create index if not exists idx_creator_clicks_creator_time
  on public.creator_clicks (creator_id, created_at desc);

-- The portal NEVER reads creator_clicks directly. PostgREST caps
-- every response at 1000 rows silently, so a busy creator would
-- read a truncated count and never know. Portal reads this rollup.
create table if not exists public.creator_click_daily (
  creator_id uuid not null references public.creators(id) on delete cascade,
  day        date not null,
  platform   text not null default 'other',
  campaign   text not null default '',
  clicks     integer not null default 0,
  primary key (creator_id, day, platform, campaign)
);


-- =============================================================
-- 4. Earnings + milestones
-- =============================================================
-- creator_earnings is the authoritative ledger of what a creator
-- earned. point_transactions is a DERIVED credit that only happens
-- when the creator has a linked member account — a creator who has
-- never installed the app still accrues here.

create table if not exists public.creator_earnings (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creators(id) on delete cascade,
  referral_id   uuid unique references public.referrals(id) on delete set null,
  kind          text not null check (kind in ('conversion','milestone','manual')),
  points_amount integer not null default 0,
  note          text,
  credited_at   timestamptz,   -- when it reached point_transactions, if ever
  created_at    timestamptz not null default now()
);

comment on column public.creator_earnings.referral_id is
  'UNIQUE — one conversion earning per referral, ever. The uniqueness is the idempotency guard, not a lock.';

create index if not exists idx_creator_earnings_creator
  on public.creator_earnings (creator_id, created_at desc);

-- What each rung pays, and what ships. Config, not code, so the
-- ladder can be tuned without a deploy.
create table if not exists public.creator_milestone_tiers (
  n            integer primary key check (n > 0),
  label        text not null,
  points       integer not null default 0,
  product_sku  text,
  active       boolean not null default true
);

-- One row per (creator, rung) = that rung was awarded. The PRIMARY
-- KEY is the idempotency guard — two conversions landing at once
-- can both count >= n, but only one insert wins. Same shape as
-- live_event_invite_milestones, and auditable unlike an advisory lock.
--
-- Until P2's fulfilment tracking lands, a row here with a
-- product_sku IS the "owed" record. Nothing ships automatically.
create table if not exists public.creator_milestones (
  creator_id      uuid not null references public.creators(id) on delete cascade,
  n               integer not null,
  converted_count integer not null,
  points_paid     integer not null default 0,
  product_sku     text,
  fulfilment_status text not null default 'owed'
                    check (fulfilment_status in ('owed','approved','shipped','delivered','cancelled','not_applicable')),
  created_at      timestamptz not null default now(),
  primary key (creator_id, n)
);


-- =============================================================
-- 5. referrals — widen to carry a creator
-- =============================================================
-- Safe: 0 rows in production.

alter table public.referrals
  alter column referrer_id drop not null;

alter table public.referrals
  add column if not exists creator_id uuid references public.creators(id) on delete set null,
  add column if not exists source     text,
  add column if not exists campaign   text,
  add column if not exists click_id   uuid references public.creator_clicks(id) on delete set null;

-- Exactly one attributor. A referral is either a member's invite or
-- a creator's — never both, never neither.
alter table public.referrals
  drop constraint if exists referrals_one_attributor;
alter table public.referrals
  add constraint referrals_one_attributor
    check (num_nonnulls(referrer_id, creator_id) = 1);

create index if not exists idx_referrals_creator
  on public.referrals (creator_id) where creator_id is not null;

comment on column public.referrals.creator_id is
  'Set when the code resolved to a creator. referrer_id is then NULL, which deliberately keeps creator signups OUT of the live-event entry gate (it counts referrals BY referrer) — a creator''s reach must not buy a race slot.';


-- =============================================================
-- 6. Code resolution
-- =============================================================
-- Creator alias first, then member POWR ID. One function, so
-- process_referral and any admin lookup can never disagree.

create or replace function public.creator_default_conversion_points()
returns integer
language sql
immutable
as $$ select 50 $$;

comment on function public.creator_default_conversion_points() is
  'Points a creator earns per converted signup when creators.conversion_points is null.';

create or replace function public.resolve_invite_code(p_code text)
returns table (kind text, referrer_id uuid, creator_id uuid, member_user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with norm as (select upper(trim(p_code)) as c)
  select 'creator'::text, null::uuid, cr.id, cr.member_user_id
    from public.creators cr, norm
   where cr.code = norm.c
     and cr.status = 'active'
  union all
  select 'member'::text, p.id, null::uuid, p.id
    from public.profiles p, norm
   where p.referral_code = norm.c
     -- A creator alias always wins; never return both.
     and not exists (select 1 from public.creators c2 where c2.code = norm.c and c2.status = 'active')
  limit 1;
$$;

comment on function public.resolve_invite_code(text) is
  'Resolves an invite code to a creator alias FIRST, then a member POWR ID. profiles.referral_code stays the one member identifier; creators.code is an alias, not a second ID.';

-- NOT granted to authenticated, deliberately. This returns a uuid for any code
-- handed to it, so an exposed version is a code-enumeration oracle: brute-force
-- the 8-char space, harvest user ids. process_referral is SECURITY DEFINER, so
-- it executes this as the owner and needs no caller grant.
revoke all on function public.resolve_invite_code(text) from public, anon, authenticated;


-- =============================================================
-- 7. process_referral — now accepts creator codes
-- =============================================================
-- Unchanged for members. The window, the self-referral block and
-- the record-only-pay-nothing behaviour all survive exactly.

create or replace function public.process_referral(p_referral_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred_id uuid := auth.uid();
  v_created_at  timestamptz;
  v_res         record;
begin
  if v_referred_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  p_referral_code := upper(trim(p_referral_code));

  select * into v_res from public.resolve_invite_code(p_referral_code);

  if v_res.kind is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  -- Self-referral: for a creator this means their OWN member
  -- account typing their OWN alias.
  if v_res.member_user_id = v_referred_id then
    return jsonb_build_object('success', false, 'error', 'self_referral');
  end if;

  -- The grace window. Checked AFTER the code is resolved so a user
  -- who is out of time still learns their code was real.
  select created_at into v_created_at
    from public.profiles
   where id = v_referred_id;

  if v_created_at is not null
     and v_created_at < now() - public.referral_entry_window() then
    return jsonb_build_object('success', false, 'error', 'window_closed');
  end if;

  begin
    insert into public.referrals (referrer_id, referred_id, creator_id)
      values (v_res.referrer_id, v_referred_id, v_res.creator_id);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_referred');
  end;

  return jsonb_build_object(
    'success',     true,
    'kind',        v_res.kind,
    'referrer_id', v_res.referrer_id,
    'creator_id',  v_res.creator_id,
    'reward',      0,
    'status',      'pending_first_workout'
  );
end;
$$;


-- =============================================================
-- 8. referral_entry_state — must not lose creator referrals
-- =============================================================
-- The previous version INNER JOINed profiles on referrer_id. A
-- creator referral has referrer_id NULL, so that join dropped the
-- row and the Settings screen would report "not referred", offer
-- the entry field again, and hand back 'already_referred' on
-- submit. Exactly the failure the original migration called out
-- for missing display names — same trap, different null.

create or replace function public.referral_entry_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_created_at  timestamptz;
  v_found       boolean := false;
  v_name        text;
  v_deadline    timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('referred', false, 'eligible', false);
  end if;

  select true,
         coalesce(
           cr.display_name,
           nullif(trim(rp.display_name), ''),
           '@' || rp.username,
           'a friend')
    into v_found, v_name
    from public.referrals r
    left join public.profiles rp on rp.id = r.referrer_id
    left join public.creators cr on cr.id = r.creator_id
   where r.referred_id = v_uid;

  -- SELECT INTO with no matching row sets the target to NULL, not
  -- false — coalesce or an unreferred user falls through a NULL test.
  if coalesce(v_found, false) then
    return jsonb_build_object('referred', true, 'eligible', false, 'referrer_name', v_name);
  end if;

  select created_at into v_created_at from public.profiles where id = v_uid;
  v_deadline := coalesce(v_created_at, now()) + public.referral_entry_window();

  return jsonb_build_object(
    'referred',  false,
    'eligible',  v_deadline > now(),
    'days_left', greatest(0, ceil(extract(epoch from (v_deadline - now())) / 86400)::int)
  );
end;
$$;


-- =============================================================
-- 9. referral_conversion_check — branch on creator vs member
-- =============================================================
-- Member path is byte-for-byte the behaviour that shipped. The
-- creator path is added alongside it.
--
-- Both hard rules survive untouched:
--   * NEVER block the session write (never-drop-a-workout).
--   * Manual NEVER converts. Creators have MORE incentive to farm
--     than friends do, so this gets stricter, never looser.

create or replace function public.referral_conversion_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral   public.referrals;
  v_event      public.live_events;
  v_creator    public.creators;
  v_claims     text;
  v_verif      text;
  v_bonus      integer  := 20;
  v_verifs     text[]   := '{geofence,wearable}';
  v_acts       text[]   := '{gym,running,cycling,hiit,yoga,swimming,sports}';
  v_milestone_n     integer;
  v_milestone_bonus integer;
  v_converted  integer;
  v_paid       integer;
  v_cpoints    integer;
  v_earning_id uuid;
  v_tier       public.creator_milestone_tiers;
begin
  -- Cheap exits first: this runs on every session insert forever.
  if new.flagged then
    return new;
  end if;

  -- 'health' and 'wearable' are the same thing (see
  -- lib/health/dataSource.ts); normalise before matching config.
  v_verif := case when new.verification::text = 'health' then 'wearable'
                  else new.verification::text end;
  if v_verif = 'manual' then
    return new;
  end if;

  -- Unlocked existence probe: exits for every session by a user
  -- with no pending referral (i.e. almost all of them) before any
  -- event lookup. Racing duplicates are settled by the atomic
  -- claim below, not here.
  if not exists (
    select 1 from public.referrals
    where referred_id = new.user_id and converted_at is null
  ) then
    return new;
  end if;

  -- Active event = scheduled/live with conversions still open.
  select * into v_event
    from public.live_events
   where status in ('scheduled', 'live')
     and now() <= coalesce(conversion_deadline_at, window_end_at)
   order by window_start_at
   limit 1;

  if v_event.id is not null then
    v_bonus           := v_event.invite_bonus_points;
    v_verifs          := v_event.conversion_verifications;
    v_acts            := v_event.conversion_activities;
    v_milestone_n     := v_event.invite_milestone_n;
    v_milestone_bonus := v_event.invite_milestone_bonus;
  end if;

  if not (v_verif = any (v_verifs)) or not (new.type::text = any (v_acts)) then
    return new;
  end if;

  -- Atomic claim: only one session ever converts a referral, even
  -- with concurrent qualifying inserts for the same user.
  update public.referrals
     set converted_at = now(),
         converting_session_id = new.id,
         event_id = v_event.id
   where referred_id = new.user_id
     and converted_at is null
  returning * into v_referral;

  if v_referral.id is null then
    return new;
  end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config(
    'request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text,
    true
  );

  -- ── The invitee is paid identically on both paths ────────────
  -- Their side of the deal is what makes the code worth using; it
  -- must not depend on who handed it to them.
  if v_bonus > 0 then
    insert into public.point_transactions (user_id, amount, type, source, description)
      values (new.user_id, v_bonus, 'bonus', 'referral_received',
              'First workout done — invite reward unlocked');
  end if;

  if v_referral.creator_id is not null then
    -- ── CREATOR PATH ──────────────────────────────────────────
    select * into v_creator from public.creators where id = v_referral.creator_id;

    -- A paused or terminated creator still gets the conversion
    -- RECORDED (the referral row stands, the invitee keeps their
    -- points) but earns nothing further.
    if v_creator.id is not null and v_creator.status = 'active' then
      v_cpoints := coalesce(v_creator.conversion_points,
                            public.creator_default_conversion_points());

      insert into public.creator_earnings
        (creator_id, referral_id, kind, points_amount, note)
      values (v_creator.id, v_referral.id, 'conversion', v_cpoints,
              'Signup converted — first verified workout')
      on conflict (referral_id) do nothing
      returning id into v_earning_id;

      -- Credit points only if they actually have an app account.
      -- Otherwise the ledger holds it until they link one.
      if v_earning_id is not null and v_cpoints > 0
         and v_creator.member_user_id is not null then
        insert into public.point_transactions (user_id, amount, type, source, description)
          values (v_creator.member_user_id, v_cpoints, 'bonus', 'creator_conversion',
                  'A signup from your link logged their first workout');
        update public.creator_earnings set credited_at = now() where id = v_earning_id;
      end if;

      -- ── Creator milestone ladder ─────────────────────────────
      select count(*) into v_converted
        from public.referrals
       where creator_id = v_creator.id
         and converted_at is not null;

      -- Highest rung reached and not yet awarded. One per
      -- conversion at most; the PK settles concurrent winners.
      select * into v_tier
        from public.creator_milestone_tiers t
       where t.active
         and t.n <= v_converted
         and not exists (
           select 1 from public.creator_milestones m
            where m.creator_id = v_creator.id and m.n = t.n)
       order by t.n desc
       limit 1;

      if v_tier.n is not null then
        insert into public.creator_milestones
          (creator_id, n, converted_count, points_paid, product_sku, fulfilment_status)
        values (v_creator.id, v_tier.n, v_converted, v_tier.points, v_tier.product_sku,
                case when v_tier.product_sku is null then 'not_applicable' else 'owed' end)
        on conflict (creator_id, n) do nothing;
        get diagnostics v_paid = row_count;

        if v_paid = 1 and v_tier.points > 0 then
          insert into public.creator_earnings
            (creator_id, kind, points_amount, note)
          values (v_creator.id, 'milestone', v_tier.points,
                  v_tier.label || ' — ' || v_tier.n || ' conversions')
          returning id into v_earning_id;

          if v_creator.member_user_id is not null then
            insert into public.point_transactions (user_id, amount, type, source, description)
              values (v_creator.member_user_id, v_tier.points, 'bonus', 'creator_milestone',
                      v_tier.n || ' signups converted — ' || v_tier.label);
            update public.creator_earnings set credited_at = now() where id = v_earning_id;
          end if;
        end if;
      end if;
    end if;

  else
    -- ── MEMBER PATH (unchanged) ───────────────────────────────
    if v_bonus > 0 then
      insert into public.point_transactions (user_id, amount, type, source, description)
        values (v_referral.referrer_id, v_bonus, 'bonus', 'referral_sent',
                'Your friend logged their first workout');
    end if;

    -- Milestone: Nth conversion for this event pays once, ever —
    -- the primary key on the milestone ledger is the guard.
    if v_event.id is not null and v_milestone_bonus > 0 then
      select count(*) into v_converted
        from public.referrals
       where referrer_id = v_referral.referrer_id
         and event_id = v_event.id
         and converted_at is not null;

      if v_converted >= v_milestone_n then
        insert into public.live_event_invite_milestones
          (event_id, referrer_id, converted_count, points_paid)
        values (v_event.id, v_referral.referrer_id, v_converted, v_milestone_bonus)
        on conflict (event_id, referrer_id) do nothing;
        get diagnostics v_paid = row_count;

        if v_paid = 1 then
          insert into public.point_transactions (user_id, amount, type, source, description)
            values (v_referral.referrer_id, v_milestone_bonus, 'bonus', 'invite_milestone',
                    v_milestone_n || ' friends converted — milestone bonus');
        end if;
      end if;
    end if;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return new;

exception when others then
  -- A conversion failure must never cost a workout. Everything
  -- above (stamp, claims swap, payments) rolls back to this
  -- block's savepoint; the session insert proceeds untouched.
  raise warning 'referral_conversion_check failed for session %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.referral_conversion_check() from public, anon, authenticated;


-- =============================================================
-- 10. RLS
-- =============================================================
-- Every creator-scoped policy carries its creator_id predicate in
-- the POLICY, not in the client query. Portal reads have a
-- systemic history of missing owner filters; this is where that
-- gets prevented, not in a .eq() someone can forget.

alter table public.creators               enable row level security;
alter table public.creator_users          enable row level security;
alter table public.creator_invites        enable row level security;
alter table public.creator_clicks         enable row level security;
alter table public.creator_click_daily    enable row level security;
alter table public.creator_earnings       enable row level security;
alter table public.creator_milestones     enable row level security;
alter table public.creator_milestone_tiers enable row level security;

-- Helper: the calling portal user's creator, if any.
create or replace function public.current_creator_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select creator_id from public.creator_users where user_id = auth.uid()
$$;

revoke all on function public.current_creator_id() from public, anon;
grant execute on function public.current_creator_id() to authenticated;

-- ── creators ─────────────────────────────────────────────────
drop policy if exists "Creators read own row" on public.creators;
create policy "Creators read own row"
  on public.creators for select to authenticated
  using (id = public.current_creator_id());

drop policy if exists "Creators update own profile" on public.creators;
create policy "Creators update own profile"
  on public.creators for update to authenticated
  using      (id = public.current_creator_id())
  with check (id = public.current_creator_id());

-- An RLS policy cannot restrict WHICH COLUMNS an update touches, and the row a
-- creator owns contains their own payout rate, status and code. Without this,
-- "update your own profile" also means "set conversion_points to 1000000",
-- "un-pause yourself", "re-point member_user_id at someone else's account" or
-- "steal another creator's vanity code". The column grant is the real fence;
-- the policy only decides WHICH ROW.
revoke update on public.creators from authenticated;
grant update (display_name, avatar_url, bio, shipping_name, shipping_address)
  on public.creators to authenticated;

-- Note for P2: admins are also the `authenticated` role, so the revoke above
-- applies to them too — the "Admins manage creators" policy will pass and the
-- column grant will still refuse. That is intended. Admin mutations (status,
-- code, conversion_points, member_user_id) go through the manage-creator-user
-- edge function under service_role, exactly like manage-partner-user does for
-- brands. Do not "fix" a permission-denied here by widening the grant.

drop policy if exists "Admins manage creators" on public.creators;
create policy "Admins manage creators"
  on public.creators for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── creator_users ────────────────────────────────────────────
drop policy if exists "Portal users read own link" on public.creator_users;
create policy "Portal users read own link"
  on public.creator_users for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins manage creator users" on public.creator_users;
create policy "Admins manage creator users"
  on public.creator_users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── creator_invites: admin only ──────────────────────────────
-- Deliberately no self-serve read. The token is a credential; it
-- is handled by the edge function under service role.
drop policy if exists "Admins manage creator invites" on public.creator_invites;
create policy "Admins manage creator invites"
  on public.creator_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── clicks: rollup readable, raw table admin-only ────────────
drop policy if exists "Admins read creator clicks" on public.creator_clicks;
create policy "Admins read creator clicks"
  on public.creator_clicks for select to authenticated
  using (public.is_admin());

drop policy if exists "Creators read own click rollup" on public.creator_click_daily;
create policy "Creators read own click rollup"
  on public.creator_click_daily for select to authenticated
  using (creator_id = public.current_creator_id());

drop policy if exists "Admins read click rollup" on public.creator_click_daily;
create policy "Admins read click rollup"
  on public.creator_click_daily for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── earnings + milestones ────────────────────────────────────
drop policy if exists "Creators read own earnings" on public.creator_earnings;
create policy "Creators read own earnings"
  on public.creator_earnings for select to authenticated
  using (creator_id = public.current_creator_id());

drop policy if exists "Admins manage earnings" on public.creator_earnings;
create policy "Admins manage earnings"
  on public.creator_earnings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Creators read own milestones" on public.creator_milestones;
create policy "Creators read own milestones"
  on public.creator_milestones for select to authenticated
  using (creator_id = public.current_creator_id());

drop policy if exists "Admins manage milestones" on public.creator_milestones;
create policy "Admins manage milestones"
  on public.creator_milestones for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Anyone signed in reads tiers" on public.creator_milestone_tiers;
create policy "Anyone signed in reads tiers"
  on public.creator_milestone_tiers for select to authenticated
  using (true);

drop policy if exists "Admins manage tiers" on public.creator_milestone_tiers;
create policy "Admins manage tiers"
  on public.creator_milestone_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- referrals: creators see their OWN attributed rows, and only the
-- non-identifying columns are ever selected by the portal (the
-- /partner precedent deliberately omits claimed-by).
drop policy if exists "Creators read own attributed referrals" on public.referrals;
create policy "Creators read own attributed referrals"
  on public.referrals for select to authenticated
  using (creator_id = public.current_creator_id());


-- =============================================================
-- 11. Portal funnel — one RPC, aggregates only
-- =============================================================
-- The portal home reads THIS, never raw tables. Keeps the 1000-row
-- PostgREST cap out of the numbers a creator is paid on.

-- p_creator_id is ADMIN-ONLY: it powers "view portal as this creator" the same
-- way the brand portal's admin preview does. A creator passing someone else's
-- id is ignored, not honoured — the caller's own binding always wins.
create or replace function public.creator_funnel(
  p_days       integer default 30,
  p_creator_id uuid    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_creator_id uuid := public.current_creator_id();
  v_since      date;
  v_clicks     integer;
  v_signups    integer;
  v_converted  integer;
  v_points     integer;
begin
  if v_creator_id is null then
    if not public.is_admin() then
      return jsonb_build_object('error', 'not_a_creator');
    end if;
    if p_creator_id is null then
      return jsonb_build_object('error', 'no_creator_context');
    end if;
    v_creator_id := p_creator_id;
  end if;

  p_days  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since := (now() - make_interval(days => p_days))::date;

  select coalesce(sum(clicks), 0) into v_clicks
    from public.creator_click_daily
   where creator_id = v_creator_id and day >= v_since;

  select count(*),
         count(*) filter (where converted_at is not null)
    into v_signups, v_converted
    from public.referrals
   where creator_id = v_creator_id
     and created_at >= v_since;

  select coalesce(sum(points_amount), 0) into v_points
    from public.creator_earnings
   where creator_id = v_creator_id;

  return jsonb_build_object(
    'days',           p_days,
    'clicks',         v_clicks,
    'signups',        v_signups,
    'converted',      v_converted,
    'points_earned',  v_points,
    -- The number that decides whether we ever buy Branch.
    'click_to_signup', case when v_clicks > 0
                            then round((v_signups::numeric / v_clicks) * 100, 1)
                            else null end
  );
end;
$$;

revoke all on function public.creator_funnel(integer, uuid) from public, anon;
grant execute on function public.creator_funnel(integer, uuid) to authenticated;


-- =============================================================
-- 12. Click rollup
-- =============================================================
create or replace function public.rollup_creator_clicks(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  insert into public.creator_click_daily (creator_id, day, platform, campaign, clicks)
  select creator_id,
         created_at::date,
         coalesce(platform, 'other'),
         coalesce(campaign, ''),
         count(*)
    from public.creator_clicks
   where created_at >= (now() - make_interval(days => greatest(p_days, 1)))
   group by 1, 2, 3, 4
  on conflict (creator_id, day, platform, campaign)
    do update set clicks = excluded.clicks;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.rollup_creator_clicks(integer) from public, anon;
grant execute on function public.rollup_creator_clicks(integer) to authenticated;


-- =============================================================
-- 13. Seed the milestone ladder (points only — no SKUs yet)
-- =============================================================
-- Product SKUs are left null on purpose: a rung with a SKU creates
-- an 'owed' shipment, and we are not shipping anything until the
-- ladder is agreed and the fulfilment queue (P2) exists.

insert into public.creator_milestone_tiers (n, label, points, product_sku, active) values
  (5,   'First five',   250,  null, true),
  (25,  'Twenty-five',  1500, null, true),
  (100, 'Century',      7500, null, true)
on conflict (n) do nothing;
