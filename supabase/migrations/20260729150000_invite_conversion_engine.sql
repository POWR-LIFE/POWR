-- =============================================================
-- INVITE CONVERSION ENGINE (Live Events ticket 2)
-- =============================================================
-- Spec: context/LIVE_EVENTS_PLAN.md §1 invites, §3 data model.
--
-- Revolut-style mechanic: entering a friend's code at signup no
-- longer pays anyone. The referral is recorded as PENDING and
-- "converts" when the new user logs their first qualifying
-- verified workout — geofence or wearable; manual NEVER converts
-- (a farmable path: type a code, log a fake workout, collect).
-- Conversion pays BOTH sides, and a referrer's Nth conversion
-- (default 5) pays a milestone bonus on top.
--
-- Everything is config-on-the-event-row: bonus amounts, milestone
-- N + amount, which verifications and activity types qualify, and
-- the conversion deadline. A conversion while an event is
-- scheduled/live and inside its deadline is attributed to that
-- event (event_id on the referral row — the invite-funnel unit
-- ticket 6 counts); outside any event the platform defaults below
-- apply and no milestone is paid.
--
-- Payments are type='bonus', which NEVER counts on any board
-- (event or global) — invite rewards must not buy rank.
-- =============================================================

-- ── referrals: conversion columns ─────────────────────────────

alter table public.referrals
  add column if not exists converted_at          timestamptz,
  add column if not exists converting_session_id uuid references public.activity_sessions(id) on delete set null,
  add column if not exists event_id              uuid references public.live_events(id) on delete set null;

-- process_referral guards this with an EXISTS check but nothing
-- enforced it under concurrency. Table has 0 rows; free to add.
create unique index if not exists referrals_referred_once
  on public.referrals (referred_id);

-- ── live_events: which activity types can convert ─────────────
-- Deliberately narrower than the scoring list: walking and sleep
-- sessions are auto-created from wearable data, so leaving them in
-- would convert every invitee who merely connects a watch — no
-- deliberate workout involved. "First verified workout" means
-- training, not existing.

alter table public.live_events
  add column if not exists conversion_activities text[] not null
    default '{gym,running,cycling,hiit,yoga,swimming,sports}';

-- ── milestone ledger ──────────────────────────────────────────
-- One row per (event, referrer) = the milestone was paid. The
-- primary key is the idempotency guard: two invitees converting
-- concurrently can both count >= N, but only one insert wins and
-- only the winner pays. Auditable, unlike an advisory lock.

create table if not exists public.live_event_invite_milestones (
  event_id        uuid not null references public.live_events(id) on delete cascade,
  referrer_id     uuid not null references public.profiles(id) on delete cascade,
  converted_count integer not null,
  points_paid     integer not null,
  created_at      timestamptz not null default now(),
  primary key (event_id, referrer_id)
);

alter table public.live_event_invite_milestones enable row level security;

drop policy if exists "Users read own invite milestones" on public.live_event_invite_milestones;
create policy "Users read own invite milestones"
  on public.live_event_invite_milestones for select
  to authenticated
  using (referrer_id = auth.uid());

drop policy if exists "Admins manage invite milestones" on public.live_event_invite_milestones;
create policy "Admins manage invite milestones"
  on public.live_event_invite_milestones for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- process_referral — record only, pay nothing
-- =============================================================
-- Replaces the version that paid 20/20 immediately at code entry
-- (instantly farmable: throwaway signups with a friend's code).
-- Zero referrals ever fired in prod, so this changes no one's
-- lived behaviour. Payment now happens in the conversion trigger
-- below. Returns reward: 0 so the current client's "+N POWR"
-- alert at least never overstates; ticket 3's OTA rewrites that
-- copy to "your reward lands after their first workout".
create or replace function public.process_referral(p_referral_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_referred_id uuid := auth.uid();
begin
  if v_referred_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  p_referral_code := upper(trim(p_referral_code));

  select id into v_referrer_id
    from public.profiles
   where referral_code = p_referral_code;

  if v_referrer_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  if v_referrer_id = v_referred_id then
    return jsonb_build_object('success', false, 'error', 'self_referral');
  end if;

  begin
    insert into public.referrals (referrer_id, referred_id)
      values (v_referrer_id, v_referred_id);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_referred');
  end;

  return jsonb_build_object(
    'success',     true,
    'referrer_id', v_referrer_id,
    'reward',      0,
    'status',      'pending_first_workout'
  );
end;
$$;

-- =============================================================
-- referral_conversion_check — the conversion chokepoint
-- =============================================================
-- AFTER INSERT (and verification upgrades) on activity_sessions:
-- every session, whatever wrote it — claim-points, terra-webhook,
-- health sync, client insert — passes through here.
--
-- Two hard rules:
--   * NEVER block the session write. The whole body is wrapped in
--     an exception handler: a conversion bug must not cost anyone
--     a workout (never-drop-a-workout).
--   * Manual never converts, regardless of configuration.
--
-- Client-context inserts carry role 'authenticated', and
-- trg_enforce_point_award_cap rejects non-'earn' rows from
-- clients — so the bonus inserts borrow the transaction-local
-- service-role claims swap that process_referral established.
-- (The swap and the referral stamp both roll back to the block's
-- savepoint if anything throws, so the handler leaves no
-- half-converted state behind.)
create or replace function public.referral_conversion_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral   public.referrals;
  v_event      public.live_events;
  v_claims     text;
  v_verif      text;
  v_bonus      integer  := 20;
  v_verifs     text[]   := '{geofence,wearable}';
  v_acts       text[]   := '{gym,running,cycling,hiit,yoga,swimming,sports}';
  v_milestone_n     integer;
  v_milestone_bonus integer;
  v_converted  integer;
  v_paid       integer;
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
  -- The invite funnel runs for weeks before the scoring window
  -- opens, so 'scheduled' must attract conversions too.
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

  if v_bonus > 0 then
    insert into public.point_transactions (user_id, amount, type, source, description)
      values (new.user_id, v_bonus, 'bonus', 'referral_received',
              'First workout done — invite reward unlocked');
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

drop trigger if exists trg_referral_conversion on public.activity_sessions;
create trigger trg_referral_conversion
  after insert or update of verification on public.activity_sessions
  for each row
  when (new.verification is distinct from 'manual'::verification_method)
  execute function public.referral_conversion_check();

-- Trigger execution doesn't require caller EXECUTE, and nothing
-- should reach this through PostgREST — keep it out of the anon
-- definer-function lint budget.
revoke all on function public.referral_conversion_check() from public, anon, authenticated;
