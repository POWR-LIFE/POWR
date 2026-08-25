-- =============================================================
-- CREATOR PROGRAMMES — rules, steps, event bonus, fulfilment
-- =============================================================
-- Spec: docs/creator-program-scope.md §P2
--
-- Jamie, 2026-08-25: "rewards front and centre — full admin
-- controls: rewards for each step, points for each step, rules
-- like live events, bonus for event signups, fine-grained per
-- creator."
--
-- Shape: a PROGRAMME is a rule set, exactly the way a live_events
-- row is. Its vocabulary is copied from live_events on purpose
-- (conversion_verifications, conversion_activities, invite bonus)
-- so admins learn it once. STEPS hang off a programme. Every
-- creator points at one programme; a Default programme catches
-- the rest. Per-creator overrides stay on the creator row.
--
-- Replaces the flat global creator_milestone_tiers ladder from P0.
-- =============================================================


-- ── 1. Programmes ────────────────────────────────────────────

create table if not exists public.creator_programs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  is_default    boolean not null default false,
  active        boolean not null default true,

  -- ── What counts as a conversion (live_events vocabulary) ──
  -- Manual is never allowed in here; the trigger refuses it even
  -- if someone writes it into the array.
  conversion_verifications text[] not null default '{geofence,wearable}',
  conversion_activities    text[] not null default '{gym,running,cycling,hiit,yoga,swimming,sports}',
  -- Workout must be at least this long to convert. 0 = any length.
  min_session_minutes      integer not null default 0 check (min_session_minutes >= 0),
  -- Signup must convert within this many days of entering the
  -- code. Null = no deadline.
  conversion_window_days   integer check (conversion_window_days is null or conversion_window_days > 0),

  -- ── Per-signup payouts ────────────────────────────────────
  -- Paid to the INVITEE when they convert. Their side of the deal.
  invitee_bonus_points     integer not null default 20  check (invitee_bonus_points >= 0),
  -- Paid to the CREATOR the moment a code is entered, BEFORE any
  -- workout. Default 0 — it is the farmable one. Exposed because
  -- Jamie asked for fine-grained control, not because it's wise.
  creator_signup_points    integer not null default 0   check (creator_signup_points >= 0),
  -- Paid to the creator when the signup converts.
  creator_conversion_points integer not null default 50 check (creator_conversion_points >= 0),

  -- ── Event signup bonus ────────────────────────────────────
  -- Paid to the creator when one of their signups joins a live
  -- event. Once per (signup, event).
  event_signup_points      integer not null default 0   check (event_signup_points >= 0),
  -- Only pay if the signup has already converted. On by default:
  -- a code entry + an event tap with no workout is two taps.
  event_signup_requires_conversion boolean not null default true,

  -- ── Steps ─────────────────────────────────────────────────
  -- What the step ladder counts. Mirrors entry_gate_counting.
  step_counting text not null default 'conversions'
                  check (step_counting in ('conversions','signups')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Exactly one default.
create unique index if not exists creator_programs_one_default
  on public.creator_programs (is_default) where is_default;

comment on table public.creator_programs is
  'A creator rule set: what converts, what each side is paid, event bonus, and the step ladder (creator_program_steps). Vocabulary deliberately mirrors live_events.';


-- ── 2. Steps ─────────────────────────────────────────────────
-- A step can pay POINTS, ship a PRODUCT, and/or grant a CATALOGUE
-- REWARD — any combination. Product and reward both create an
-- owed fulfilment row an admin approves; nothing ships itself.

create table if not exists public.creator_program_steps (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references public.creator_programs(id) on delete cascade,
  n             integer not null check (n > 0),
  label         text not null,
  description   text,
  points        integer not null default 0 check (points >= 0),
  product_name  text,
  product_sku   text,
  reward_id     uuid references public.rewards(id) on delete set null,
  active        boolean not null default true,
  unique (program_id, n)
);

create index if not exists idx_program_steps_program on public.creator_program_steps (program_id, n);


-- ── 3. Creators point at a programme ─────────────────────────

alter table public.creators
  add column if not exists program_id uuid references public.creator_programs(id) on delete set null;

create index if not exists idx_creators_program on public.creators (program_id);

comment on column public.creators.program_id is
  'Which rule set applies. Null = the default programme. creators.conversion_points still overrides the programme''s creator_conversion_points when set.';


-- ── 4. creator_milestones — re-key on step ───────────────────
-- Empty table (QA rows removed), so the PK can be rebuilt.

alter table public.creator_milestones
  add column if not exists step_id      uuid references public.creator_program_steps(id) on delete set null,
  add column if not exists program_id   uuid references public.creator_programs(id) on delete set null,
  add column if not exists product_name text,
  add column if not exists reward_id    uuid references public.rewards(id) on delete set null,
  add column if not exists label        text,
  add column if not exists carrier      text,
  add column if not exists tracking_number text,
  add column if not exists approved_by  uuid references public.profiles(id),
  add column if not exists approved_at  timestamptz,
  add column if not exists shipped_at   timestamptz,
  add column if not exists notes        text;

alter table public.creator_milestones drop constraint if exists creator_milestones_pkey;
-- step_id must be NOT NULL to be a PK; guard the (empty) table first.
delete from public.creator_milestones where step_id is null;
alter table public.creator_milestones alter column step_id set not null;
alter table public.creator_milestones add primary key (creator_id, step_id);


-- ── 5. creator_earnings — more kinds, per-kind idempotency ────

alter table public.creator_earnings drop constraint if exists creator_earnings_kind_check;
alter table public.creator_earnings
  add constraint creator_earnings_kind_check
    check (kind in ('signup','conversion','milestone','event_signup','manual'));

alter table public.creator_earnings
  add column if not exists event_id uuid references public.live_events(id) on delete set null,
  add column if not exists step_id  uuid references public.creator_program_steps(id) on delete set null;

-- One earning per referral WAS the guard. Now a referral can earn
-- a signup row, a conversion row and one event row per event —
-- so the guard becomes per-kind partial uniques.
alter table public.creator_earnings drop constraint if exists creator_earnings_referral_id_key;

create unique index if not exists creator_earnings_one_signup_per_referral
  on public.creator_earnings (referral_id) where kind = 'signup';
create unique index if not exists creator_earnings_one_conversion_per_referral
  on public.creator_earnings (referral_id) where kind = 'conversion';
create unique index if not exists creator_earnings_one_event_per_referral_event
  on public.creator_earnings (referral_id, event_id) where kind = 'event_signup';
create unique index if not exists creator_earnings_one_milestone_per_step
  on public.creator_earnings (creator_id, step_id) where kind = 'milestone';


-- ── 6. Seed the Default programme from the P0 ladder ─────────

insert into public.creator_programs (name, description, is_default)
select 'Default', 'Applies to every creator without a specific programme.', true
where not exists (select 1 from public.creator_programs where is_default);

insert into public.creator_program_steps (program_id, n, label, points, product_sku)
select p.id, t.n, t.label, t.points, t.product_sku
  from public.creator_milestone_tiers t
  cross join (select id from public.creator_programs where is_default) p
on conflict (program_id, n) do nothing;

-- P0's global ladder is superseded. Keep the table for one release
-- so nothing referencing it breaks, but nothing reads it now.
comment on table public.creator_milestone_tiers is
  'SUPERSEDED by creator_program_steps (2026-08-25). Not read by any trigger or page. Safe to drop next release.';


-- ── 7. Helper: effective programme for a creator ─────────────

create or replace function public.creator_effective_program(p_creator_id uuid)
returns public.creator_programs
language sql stable security definer set search_path = public
as $$
  select p.* from public.creator_programs p
   where p.id = coalesce(
     (select c.program_id from public.creators c where c.id = p_creator_id),
     (select id from public.creator_programs where is_default limit 1))
   limit 1
$$;

revoke all on function public.creator_effective_program(uuid) from public, anon, authenticated;


-- ── 8. Step award — one place, called by both triggers ────────
-- Awards the highest reached, not-yet-awarded step. The PK on
-- creator_milestones settles concurrent winners. Points credit to
-- point_transactions only when the creator has a member account.

create or replace function public.creator_award_steps(p_creator_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_creator  public.creators;
  v_prog     public.creator_programs;
  v_count    integer;
  v_step     public.creator_program_steps;
  v_paid     integer;
  v_earning  uuid;
  v_status   text;
begin
  select * into v_creator from public.creators where id = p_creator_id;
  if v_creator.id is null or v_creator.status <> 'active' then return; end if;

  v_prog := public.creator_effective_program(p_creator_id);
  if v_prog.id is null then return; end if;

  if v_prog.step_counting = 'signups' then
    select count(*) into v_count from public.referrals where creator_id = p_creator_id;
  else
    select count(*) into v_count from public.referrals
     where creator_id = p_creator_id and converted_at is not null;
  end if;

  -- Loop so a creator assigned to a programme late catches up on
  -- every rung they've already passed, not just the top one.
  loop
    select * into v_step
      from public.creator_program_steps s
     where s.program_id = v_prog.id and s.active and s.n <= v_count
       and not exists (select 1 from public.creator_milestones m
                        where m.creator_id = p_creator_id and m.step_id = s.id)
     order by s.n
     limit 1;
    exit when v_step.id is null;

    v_status := case when v_step.product_sku is null and v_step.product_name is null
                      and v_step.reward_id is null
                     then 'not_applicable' else 'owed' end;

    insert into public.creator_milestones
      (creator_id, step_id, program_id, n, label, converted_count, points_paid,
       product_sku, product_name, reward_id, fulfilment_status)
    values
      (p_creator_id, v_step.id, v_prog.id, v_step.n, v_step.label, v_count, v_step.points,
       v_step.product_sku, v_step.product_name, v_step.reward_id, v_status)
    on conflict (creator_id, step_id) do nothing;
    get diagnostics v_paid = row_count;

    if v_paid = 1 and v_step.points > 0 then
      insert into public.creator_earnings (creator_id, kind, points_amount, note, step_id)
      values (p_creator_id, 'milestone', v_step.points,
              v_step.label || ' — ' || v_step.n || ' ' || v_prog.step_counting, v_step.id)
      on conflict do nothing
      returning id into v_earning;

      if v_earning is not null and v_creator.member_user_id is not null then
        insert into public.point_transactions (user_id, amount, type, source, description)
        values (v_creator.member_user_id, v_step.points, 'bonus', 'creator_milestone',
                v_step.n || ' ' || v_prog.step_counting || ' — ' || v_step.label);
        update public.creator_earnings set credited_at = now() where id = v_earning;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.creator_award_steps(uuid) from public, anon, authenticated;


-- ── 9. process_referral — optional signup points + step check ─

create or replace function public.process_referral(p_referral_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_referred_id uuid := auth.uid();
  v_created_at  timestamptz;
  v_res         record;
  v_ref_id      uuid;
  v_prog        public.creator_programs;
  v_creator     public.creators;
  v_claims      text;
  v_earning     uuid;
begin
  if v_referred_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  p_referral_code := upper(trim(p_referral_code));
  select * into v_res from public.resolve_invite_code(p_referral_code);

  if v_res.kind is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if v_res.member_user_id = v_referred_id then
    return jsonb_build_object('success', false, 'error', 'self_referral');
  end if;

  select created_at into v_created_at from public.profiles where id = v_referred_id;
  if v_created_at is not null
     and v_created_at < now() - public.referral_entry_window() then
    return jsonb_build_object('success', false, 'error', 'window_closed');
  end if;

  begin
    insert into public.referrals (referrer_id, referred_id, creator_id)
      values (v_res.referrer_id, v_referred_id, v_res.creator_id)
      returning id into v_ref_id;
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_referred');
  end;

  -- Creator path: signup-time points (usually 0) and a step check
  -- for programmes that count signups rather than conversions.
  if v_res.creator_id is not null then
    begin
      select * into v_creator from public.creators where id = v_res.creator_id;
      v_prog := public.creator_effective_program(v_res.creator_id);

      if v_prog.creator_signup_points > 0 and v_creator.status = 'active' then
        v_claims := current_setting('request.jwt.claims', true);
        perform set_config('request.jwt.claims',
          (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
             || jsonb_build_object('role', 'service_role'))::text, true);

        insert into public.creator_earnings (creator_id, referral_id, kind, points_amount, note)
        values (v_res.creator_id, v_ref_id, 'signup', v_prog.creator_signup_points,
                'Someone entered your code')
        on conflict do nothing
        returning id into v_earning;

        if v_earning is not null and v_creator.member_user_id is not null then
          insert into public.point_transactions (user_id, amount, type, source, description)
          values (v_creator.member_user_id, v_prog.creator_signup_points, 'bonus',
                  'creator_signup', 'Someone entered your code');
          update public.creator_earnings set credited_at = now() where id = v_earning;
        end if;

        perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      end if;

      if v_prog.step_counting = 'signups' then
        perform public.creator_award_steps(v_res.creator_id);
      end if;
    exception when others then
      -- The referral is recorded; a payout hiccup must not undo it.
      raise warning 'process_referral creator payout failed for %: %', v_ref_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'success', true, 'kind', v_res.kind,
    'referrer_id', v_res.referrer_id, 'creator_id', v_res.creator_id,
    'reward', 0, 'status', 'pending_first_workout'
  );
end;
$$;


-- ── 10. referral_conversion_check — programme rules on creator path ─
-- Member path unchanged. Creator path now decides what counts from
-- the creator's programme, not from whichever live event is open.

create or replace function public.referral_conversion_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_pending    public.referrals;
  v_referral   public.referrals;
  v_event      public.live_events;
  v_creator    public.creators;
  v_prog       public.creator_programs;
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
begin
  if new.flagged then return new; end if;

  v_verif := case when new.verification::text = 'health' then 'wearable'
                  else new.verification::text end;
  -- Manual NEVER converts, whatever any programme says.
  if v_verif = 'manual' then return new; end if;

  select * into v_pending from public.referrals
   where referred_id = new.user_id and converted_at is null
   limit 1;
  if v_pending.id is null then return new; end if;

  if v_pending.creator_id is not null then
    -- ── Creator rules come from the programme ──
    select * into v_creator from public.creators where id = v_pending.creator_id;
    v_prog := public.creator_effective_program(v_pending.creator_id);
    if v_prog.id is not null then
      v_verifs := v_prog.conversion_verifications;
      v_acts   := v_prog.conversion_activities;
      v_bonus  := v_prog.invitee_bonus_points;
      if new.duration_sec < v_prog.min_session_minutes * 60 then return new; end if;
      if v_prog.conversion_window_days is not null
         and now() > v_pending.created_at + make_interval(days => v_prog.conversion_window_days) then
        return new;
      end if;
    end if;
  else
    -- ── Member rules come from the open live event, as before ──
    select * into v_event from public.live_events
     where status in ('scheduled', 'live')
       and now() <= coalesce(conversion_deadline_at, window_end_at)
     order by window_start_at limit 1;
    if v_event.id is not null then
      v_bonus           := v_event.invite_bonus_points;
      v_verifs          := v_event.conversion_verifications;
      v_acts            := v_event.conversion_activities;
      v_milestone_n     := v_event.invite_milestone_n;
      v_milestone_bonus := v_event.invite_milestone_bonus;
    end if;
  end if;

  if not (v_verif = any (v_verifs)) or not (new.type::text = any (v_acts)) then
    return new;
  end if;

  update public.referrals
     set converted_at = now(), converting_session_id = new.id, event_id = v_event.id
   where id = v_pending.id and converted_at is null
  returning * into v_referral;
  if v_referral.id is null then return new; end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text, true);

  if v_bonus > 0 then
    insert into public.point_transactions (user_id, amount, type, source, description)
    values (new.user_id, v_bonus, 'bonus', 'referral_received',
            'First workout done — invite reward unlocked');
  end if;

  if v_referral.creator_id is not null then
    if v_creator.id is not null and v_creator.status = 'active' then
      v_cpoints := coalesce(v_creator.conversion_points, v_prog.creator_conversion_points,
                            public.creator_default_conversion_points());

      insert into public.creator_earnings (creator_id, referral_id, kind, points_amount, note)
      values (v_creator.id, v_referral.id, 'conversion', v_cpoints,
              'Signup converted — first verified workout')
      on conflict do nothing
      returning id into v_earning_id;

      if v_earning_id is not null and v_cpoints > 0 and v_creator.member_user_id is not null then
        insert into public.point_transactions (user_id, amount, type, source, description)
        values (v_creator.member_user_id, v_cpoints, 'bonus', 'creator_conversion',
                'A signup from your link logged their first workout');
        update public.creator_earnings set credited_at = now() where id = v_earning_id;
      end if;

      perform public.creator_award_steps(v_creator.id);
    end if;
  else
    if v_bonus > 0 then
      insert into public.point_transactions (user_id, amount, type, source, description)
      values (v_referral.referrer_id, v_bonus, 'bonus', 'referral_sent',
              'Your friend logged their first workout');
    end if;
    if v_event.id is not null and v_milestone_bonus > 0 then
      select count(*) into v_converted from public.referrals
       where referrer_id = v_referral.referrer_id and event_id = v_event.id
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
  raise warning 'referral_conversion_check failed for session %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.referral_conversion_check() from public, anon, authenticated;


-- ── 11. Event signup bonus ───────────────────────────────────
-- AFTER INSERT on live_event_participants. Never blocks the join.

create or replace function public.creator_event_signup_bonus()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ref     public.referrals;
  v_creator public.creators;
  v_prog    public.creator_programs;
  v_event   public.live_events;
  v_claims  text;
  v_earning uuid;
begin
  select * into v_ref from public.referrals
   where referred_id = new.user_id and creator_id is not null limit 1;
  if v_ref.id is null then return new; end if;

  select * into v_creator from public.creators where id = v_ref.creator_id;
  if v_creator.id is null or v_creator.status <> 'active' then return new; end if;

  v_prog := public.creator_effective_program(v_creator.id);
  if v_prog.id is null or v_prog.event_signup_points <= 0 then return new; end if;
  if v_prog.event_signup_requires_conversion and v_ref.converted_at is null then return new; end if;

  select * into v_event from public.live_events where id = new.event_id;
  -- Draft/preview joins are not real signups.
  if v_event.status not in ('scheduled', 'live') then return new; end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text, true);

  insert into public.creator_earnings
    (creator_id, referral_id, event_id, kind, points_amount, note)
  values (v_creator.id, v_ref.id, new.event_id, 'event_signup', v_prog.event_signup_points,
          'A signup joined ' || coalesce(v_event.name, 'a live event'))
  on conflict do nothing
  returning id into v_earning;

  if v_earning is not null and v_creator.member_user_id is not null then
    insert into public.point_transactions (user_id, amount, type, source, description)
    values (v_creator.member_user_id, v_prog.event_signup_points, 'bonus', 'creator_event_signup',
            'A signup from your link joined ' || coalesce(v_event.name, 'a live event'));
    update public.creator_earnings set credited_at = now() where id = v_earning;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return new;
exception when others then
  raise warning 'creator_event_signup_bonus failed for %/%: %', new.event_id, new.user_id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.creator_event_signup_bonus() from public, anon, authenticated;

drop trigger if exists trg_creator_event_signup_bonus on public.live_event_participants;
create trigger trg_creator_event_signup_bonus
  after insert on public.live_event_participants
  for each row execute function public.creator_event_signup_bonus();


-- ── 12. Fulfilment RPC (admin) ───────────────────────────────

create or replace function public.admin_update_creator_fulfilment(
  p_creator_id uuid, p_step_id uuid, p_status text,
  p_carrier text default null, p_tracking text default null, p_notes text default null
)
returns public.creator_milestones
language plpgsql security definer set search_path = public
as $$
declare v_row public.creator_milestones;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('owed','approved','shipped','delivered','cancelled') then
    raise exception 'invalid status';
  end if;
  update public.creator_milestones
     set fulfilment_status = p_status,
         carrier         = coalesce(p_carrier, carrier),
         tracking_number = coalesce(p_tracking, tracking_number),
         notes           = coalesce(p_notes, notes),
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         shipped_at  = case when p_status = 'shipped'  then now() else shipped_at  end
   where creator_id = p_creator_id and step_id = p_step_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_update_creator_fulfilment(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_update_creator_fulfilment(uuid, uuid, text, text, text, text) to authenticated;


-- ── 13. RLS ──────────────────────────────────────────────────

alter table public.creator_programs      enable row level security;
alter table public.creator_program_steps enable row level security;

drop policy if exists "Admins manage programmes" on public.creator_programs;
create policy "Admins manage programmes"
  on public.creator_programs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A creator reads THEIR programme (or the default) — nothing else.
drop policy if exists "Creators read own programme" on public.creator_programs;
create policy "Creators read own programme"
  on public.creator_programs for select to authenticated
  using (id = (public.creator_effective_program(public.current_creator_id())).id);

drop policy if exists "Admins manage steps" on public.creator_program_steps;
create policy "Admins manage steps"
  on public.creator_program_steps for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Creators read own programme steps" on public.creator_program_steps;
create policy "Creators read own programme steps"
  on public.creator_program_steps for select to authenticated
  using (program_id = (public.creator_effective_program(public.current_creator_id())).id);

-- creator_effective_program is invoked from policies, so the roles
-- evaluating them need EXECUTE.
grant execute on function public.creator_effective_program(uuid) to authenticated;
