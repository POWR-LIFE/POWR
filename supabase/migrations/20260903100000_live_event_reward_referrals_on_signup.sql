-- Live events: pay the REFERRER at signup instead of at conversion.
--
-- 2026-09-03, Jamie: "I think we should just reward the points on sign up at
-- this point in time for the live event as some users will not be doing
-- anything and it seems unfair that they have gotten people signed up, but
-- dont get anything straight away."
--
-- Since PR #263 (2026-07-29) `process_referral` has recorded a referral as
-- PENDING and paid nothing; the money moved only when the invited friend
-- logged their first verified session (`referral_conversion_check`). That was
-- deliberate anti-farming design, and it holds up right until the invited
-- friend cannot record anything at all. On FNL x POWR that is exactly what
-- happened: of 7 unconverted referrals, 6 belong to people whose Apple Health
-- is "connected" but silently unreadable, so the referrer's reward was
-- hostage to a bug on someone else's phone. Connor M brought 3 signups (the
-- full entry gate) and had earned 0.
--
-- The entry gate has ALWAYS been counted in signups. This makes the reward
-- agree with the gate.
--
--   live_events.reward_referrals_on_signup  (default OFF — every existing
--                                            event keeps paying exactly as
--                                            before; FNL is flipped on
--                                            separately, audit-logged)
--   referrals.signup_paid_at                (stamped when the referrer was
--                                            paid at signup; the interlock
--                                            that makes double payment
--                                            structurally impossible)
--
-- ── What is deliberately NOT changed ──────────────────────────────────────
-- The INVITEE still earns their +20 on their first verified workout. Jamie's
-- call 2026-09-03: the complaint is about the referrer waiting on someone
-- else, not about the joiner. Keeping the joiner's side on conversion means a
-- fabricated account is worth 20 to a farmer rather than 40, and still gives
-- a real new joiner a reason to record something.
--
-- ── The double-payment interlock ──────────────────────────────────────────
-- A referral paid at signup can still convert later (and should — the invitee
-- gets their +20 then). `referral_conversion_check` therefore skips ONLY the
-- referrer's `referral_sent` row when `signup_paid_at is not null`. The
-- milestone was already PK-guarded by `live_event_invite_milestones`
-- (event_id, referrer_id), so it cannot pay twice regardless of which side
-- triggered it. Net effect for a signup-paid referral that later converts:
--   referrer      +0   (already paid at signup)
--   invitee      +20   (unchanged)
--   milestone     +0   (PK conflict)
--
-- ── Milestone basis ───────────────────────────────────────────────────────
-- With the switch on, the milestone counts referrals ATTRIBUTED AND PAID to
-- the event (signup_paid_at OR converted_at) rather than conversions alone —
-- otherwise the switch would move the +20s but leave the +100 unreachable for
-- exactly the referrers it is meant to fix. With the switch off the basis is
-- conversions, byte-for-byte as before.
--
-- Both function bodies below are the CURRENT PROD bodies (fetched via
-- pg_get_functiondef 2026-09-03) with only the changes described above — never
-- an older migration file. With the new column defaulting to false both are a
-- pure restatement; §4 proves it.

-- ── 1. Columns ─────────────────────────────────────────────────────────────
alter table public.live_events
  add column if not exists reward_referrals_on_signup boolean not null default false;

comment on column public.live_events.reward_referrals_on_signup is
  'When true, the referrer is paid invite_bonus_points the moment someone signs up on their code (and the invite milestone counts signups). The invitee still earns their side on their first verified session. Default false = pay on conversion, the pre-2026-09-03 behaviour.';

alter table public.referrals
  add column if not exists signup_paid_at timestamptz;

comment on column public.referrals.signup_paid_at is
  'Set when the referrer was paid for this referral at SIGNUP (live_events.reward_referrals_on_signup). referral_conversion_check reads it to suppress a second referral_sent row if the referral later converts.';

create index if not exists referrals_referrer_event_paid_idx
  on public.referrals (referrer_id, event_id)
  where signup_paid_at is not null;

-- ── 2. process_referral: pay the referrer at signup when the event says so ──
create or replace function public.process_referral(p_referral_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_referred_id uuid := auth.uid();
  v_created_at  timestamptz;
  v_res         record;
  v_ref_id      uuid;
  v_prog        public.creator_programs;
  v_creator     public.creators;
  v_claims      text;
  v_earning     uuid;
  v_event       public.live_events;
  v_signups     integer;
  v_paid        integer;
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
      raise warning 'process_referral creator payout failed for %: %', v_ref_id, sqlerrm;
    end;
  else
    -- ── Member referral: pay the referrer NOW if the active event says so ──
    -- Event pick is the SAME predicate referral_conversion_check uses, so a
    -- referral is attributed to one event whichever side pays it. Wrapped so a
    -- payout failure can never fail the signup itself — entering a code must
    -- always succeed (never-drop-a-signup, same shape as the creator block).
    begin
      select * into v_event from public.live_events
       where status in ('scheduled', 'live')
         and now() <= coalesce(conversion_deadline_at, window_end_at)
       order by window_start_at limit 1;

      if v_event.id is not null and v_event.reward_referrals_on_signup then
        v_claims := current_setting('request.jwt.claims', true);
        perform set_config('request.jwt.claims',
          (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
             || jsonb_build_object('role', 'service_role'))::text, true);

        update public.referrals
           set event_id = v_event.id, signup_paid_at = now()
         where id = v_ref_id and signup_paid_at is null;

        if v_event.invite_bonus_points > 0 then
          insert into public.point_transactions (user_id, amount, type, source, description)
          values (v_res.referrer_id, v_event.invite_bonus_points, 'bonus', 'referral_sent',
                  'Your friend joined POWR');
        end if;

        -- Milestone on PAID signups (see header). PK-guarded, so a referral
        -- that later converts cannot pay it a second time.
        if v_event.invite_milestone_bonus > 0 then
          select count(*) into v_signups from public.referrals
           where referrer_id = v_res.referrer_id
             and event_id = v_event.id
             and (signup_paid_at is not null or converted_at is not null);
          if v_signups >= v_event.invite_milestone_n then
            insert into public.live_event_invite_milestones
              (event_id, referrer_id, converted_count, points_paid)
            values (v_event.id, v_res.referrer_id, v_signups, v_event.invite_milestone_bonus)
            on conflict (event_id, referrer_id) do nothing;
            get diagnostics v_paid = row_count;
            if v_paid = 1 then
              insert into public.point_transactions (user_id, amount, type, source, description)
              values (v_res.referrer_id, v_event.invite_milestone_bonus, 'bonus', 'invite_milestone',
                      v_event.invite_milestone_n || ' friends joined — milestone bonus');
            end if;
          end if;
        end if;

        perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      end if;
    exception when others then
      raise warning 'process_referral signup payout failed for %: %', v_ref_id, sqlerrm;
    end;
  end if;

  -- Unchanged: this is the INVITEE's receipt, and the invitee is still paid on
  -- their first verified workout either way. onboarding-achievement.tsx reads
  -- it, so it must keep saying 0 / pending_first_workout.
  return jsonb_build_object(
    'success', true, 'kind', v_res.kind,
    'referrer_id', v_res.referrer_id, 'creator_id', v_res.creator_id,
    'reward', 0, 'status', 'pending_first_workout'
  );
end;
$function$;

-- ── 3. referral_conversion_check: never pay the referrer twice ─────────────
create or replace function public.referral_conversion_check()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_on_signup  boolean := false;
begin
  if new.flagged then return new; end if;
  v_verif := case when new.verification::text = 'health' then 'wearable'
                  else new.verification::text end;
  if v_verif = 'manual' then return new; end if;

  select * into v_pending from public.referrals
   where referred_id = new.user_id and converted_at is null limit 1;
  if v_pending.id is null then return new; end if;

  if v_pending.creator_id is not null then
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
      v_on_signup       := v_event.reward_referrals_on_signup;
    end if;
  end if;

  if not (v_verif = any (v_verifs)) or not (new.type::text = any (v_acts)) then
    return new;
  end if;

  -- coalesce: a referral already attributed at signup keeps its event when the
  -- conversion happens outside any active event window.
  update public.referrals
     set converted_at = now(), converting_session_id = new.id,
         event_id = coalesce(event_id, v_event.id)
   where id = v_pending.id and converted_at is null
  returning * into v_referral;
  if v_referral.id is null then return new; end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text, true);

  -- The INVITEE's side is unconditional: it is the reward for this very
  -- session, and it is never paid at signup.
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
    -- THE INTERLOCK: skip the referrer's row when signup already paid it.
    if v_bonus > 0 and v_referral.signup_paid_at is null then
      insert into public.point_transactions (user_id, amount, type, source, description)
      values (v_referral.referrer_id, v_bonus, 'bonus', 'referral_sent',
              'Your friend logged their first workout');
    end if;
    if v_event.id is not null and v_milestone_bonus > 0 then
      -- Basis follows the switch (see header); PK guards it either way.
      if v_on_signup then
        select count(*) into v_converted from public.referrals
         where referrer_id = v_referral.referrer_id and event_id = v_event.id
           and (signup_paid_at is not null or converted_at is not null);
      else
        select count(*) into v_converted from public.referrals
         where referrer_id = v_referral.referrer_id and event_id = v_event.id
           and converted_at is not null;
      end if;
      if v_converted >= v_milestone_n then
        insert into public.live_event_invite_milestones
          (event_id, referrer_id, converted_count, points_paid)
        values (v_event.id, v_referral.referrer_id, v_converted, v_milestone_bonus)
        on conflict (event_id, referrer_id) do nothing;
        get diagnostics v_paid = row_count;
        if v_paid = 1 then
          insert into public.point_transactions (user_id, amount, type, source, description)
          values (v_referral.referrer_id, v_milestone_bonus, 'bonus', 'invite_milestone',
                  case when v_on_signup then v_milestone_n || ' friends joined — milestone bonus'
                       else v_milestone_n || ' friends converted — milestone bonus' end);
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
$function$;

-- ── 4. Proof the redefinitions are inert with the switch off ───────────────
-- Every existing event has reward_referrals_on_signup = false (column default,
-- no backfill), so process_referral's new branch is unreachable and
-- referral_conversion_check's new predicates reduce to the old ones:
--   * signup_paid_at is NULL on every pre-existing row, so the interlock
--     `v_referral.signup_paid_at is null` is always true → referral_sent is
--     inserted exactly as before;
--   * v_on_signup is false → the milestone counts conversions, the old query;
--   * event_id = coalesce(v_event.id, event_id) equals v_event.id whenever
--     v_event is non-null, which is the only branch that reaches the milestone.
do $$
declare v_bad integer;
begin
  select count(*) into v_bad from public.live_events where reward_referrals_on_signup;
  if v_bad <> 0 then
    raise warning 'migration expected 0 events with reward_referrals_on_signup, found %', v_bad;
  end if;
  select count(*) into v_bad from public.referrals where signup_paid_at is not null;
  if v_bad <> 0 then
    raise warning 'migration expected 0 referrals with signup_paid_at, found %', v_bad;
  end if;
end $$;
