-- =============================================================
-- Live events: every invite belongs to one event
-- =============================================================
-- With one event at a time, "the event" an invite counted for was simply
-- the open one (process_referral / referral_conversion_check both picked
-- `order by window_start_at limit 1`). Now several can be open, and a venue
-- event (audience_mode = 'venue', see 20260924160000) must not hand its
-- invite settings to every referral on the platform. Changes:
--
--   _live_event_referral_event(referrer)
--       The ONE open event (scheduled/live, before its conversion deadline)
--       a referrer's new invite belongs to. It must be one they're
--       registered for or an everyone-event; one they're registered for
--       wins, earliest start breaks ties. If none qualifies, the invite
--       follows platform defaults, as it does between events today.
--
--   process_referral
--       Records referrals.event_id at SIGNUP for every member referral,
--       not only when the event pays the referrer at signup. The invite
--       happened during that event's campaign, and the entry gate now
--       reads the attribution.
--
--   referral_conversion_check
--       Applies the recorded event's settings while it is still taking
--       conversions. A referral recorded against an event that has since
--       closed converts on platform defaults (it never moves to another
--       event). An unrecorded one (older rows, or a signup made between
--       events) takes the pick, as before.
--
--   _live_event_gate_count / _live_event_invitees
--       A referral attributed to a DIFFERENT event no longer counts toward
--       this event's gate. The time rules are unchanged.
--
--   get_my_invite_progress(p_event_id default null)
--       Takes the event the app is showing. With no argument (older builds)
--       it prefers an open event the caller is in, then an everyone-event,
--       instead of the earliest start. Dropped and re-created: adding a
--       defaulted parameter with CREATE OR REPLACE would leave two versions
--       and make the no-argument call ambiguous.
--
-- Every function below is re-stated from prod (pg_get_functiondef,
-- 2026-09-24); only the lines described here change.

create or replace function public._live_event_referral_event(p_referrer uuid)
returns public.live_events
language sql
stable
security definer
set search_path = public
as $$
  select e.*
    from public.live_events e
    left join public.live_event_participants lp
           on lp.event_id = e.id
          and lp.user_id = p_referrer
          and lp.disqualified_at is null
   where e.status in ('scheduled', 'live')
     and now() <= coalesce(e.conversion_deadline_at, e.window_end_at)
     and (e.audience_mode = 'all' or lp.user_id is not null)
   order by (lp.user_id is not null) desc, e.window_start_at
   limit 1
$$;

revoke all on function public._live_event_referral_event(uuid) from public, anon, authenticated;

-- ── process_referral ────────────────────────────────────────────────────────
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
    -- Member referral: attribute it to the event it was made under, and pay
    -- the referrer NOW if that event says so. Same pick as
    -- referral_conversion_check. Wrapped so neither can fail the signup.
    begin
      v_event := public._live_event_referral_event(v_res.referrer_id);

      if v_event.id is not null then
        update public.referrals
           set event_id = v_event.id
         where id = v_ref_id and event_id is null;
      end if;

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

  return jsonb_build_object(
    'success', true, 'kind', v_res.kind,
    'referrer_id', v_res.referrer_id, 'creator_id', v_res.creator_id,
    'reward', 0, 'status', 'pending_first_workout'
  );
end;
$$;

-- ── referral_conversion_check ───────────────────────────────────────────────
create or replace function public.referral_conversion_check()
returns trigger
language plpgsql
security definer
set search_path = public
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
    -- The event the invite was made under, while it still takes
    -- conversions. Recorded but closed: platform defaults (the invite never
    -- moves to another event). Unrecorded: whichever event it belongs to now.
    if v_pending.event_id is not null then
      select * into v_event from public.live_events e
       where e.id = v_pending.event_id
         and e.status in ('scheduled', 'live')
         and now() <= coalesce(e.conversion_deadline_at, e.window_end_at);
    else
      v_event := public._live_event_referral_event(v_pending.referrer_id);
    end if;
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
    if v_bonus > 0 and v_referral.signup_paid_at is null then
      insert into public.point_transactions (user_id, amount, type, source, description)
      values (v_referral.referrer_id, v_bonus, 'bonus', 'referral_sent',
              'Your friend logged their first workout');
    end if;
    if v_event.id is not null and v_milestone_bonus > 0 then
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
$$;

-- ── Entry gate: skip invites attributed to another event ────────────────────
create or replace function public._live_event_gate_count(p_event_id uuid, p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.referrals r
  cross join public.live_events ev
  where ev.id = p_event_id
    and r.referrer_id = p_uid
    and (r.event_id is null or r.event_id = ev.id)
    and (ev.entry_gate_since is null or r.created_at >= ev.entry_gate_since)
    and case
          when ev.entry_gate_counting = 'conversions'
            then r.converted_at is not null
             and r.converted_at < public._live_event_gate_deadline(ev)
          else r.created_at < public._live_event_gate_deadline(ev)
        end
$$;

create or replace function public._live_event_invitees(p_event_id uuid, p_uid uuid, p_with_email boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'referred_id',      f.referred_id,
        'name',             f.name,
        'display_name',     f.display_name,
        'username',         f.username,
        'avatar_url',       f.avatar_url,
        'member_id',        f.member_id,
        'email',            case when p_with_email then f.email else null end,
        'created_at',       f.created_at,
        'converted_at',     f.converted_at,
        'converted',        f.converted_at is not null,
        'for_event',        f.for_event,
        'counts_for_event', f.counts_for_event
      )
      -- The ones that count lead, then the freshest signups: the
      -- order the list is read in.
      order by f.counts_for_event desc, f.created_at desc
    ), '[]'::jsonb)
  from (
    select r.referred_id,
           coalesce(p.display_name, p.username, 'POWR member') as name,
           p.display_name,
           p.username,
           p.avatar_url,
           p.referral_code as member_id,
           u.email,
           r.created_at,
           r.converted_at,
           (ev.id is not null and r.event_id = ev.id) as for_event,
           case
             when ev.id is null then false
             when ev.entry_gate_n > 0 then
               (ev.entry_gate_since is null or r.created_at >= ev.entry_gate_since)
               and (ev.entry_gate_counting <> 'conversions' or r.converted_at is not null)
               and (r.event_id is null or r.event_id = ev.id)
             else (r.event_id = ev.id and r.converted_at is not null)
           end as counts_for_event
      from public.referrals r
      join public.profiles p on p.id = r.referred_id
      left join auth.users u on u.id = r.referred_id
      -- Null p_event_id (no live event) joins to nothing: every row
      -- comes back flagged as counting for nothing, which is true.
      left join public.live_events ev on ev.id = p_event_id
     where r.referrer_id = p_uid
     order by r.created_at desc
     limit 200
  ) f
$$;

-- ── get_my_invite_progress(p_event_id) ─────────────────────────────────────
drop function if exists public.get_my_invite_progress();

create function public.get_my_invite_progress(p_event_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.live_events;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- Only an event still taking invites has an invite card, pinned or not —
  -- the same window the no-argument pick always used.
  select e.* into v_event
    from public.live_events e
    left join public.live_event_participants lp
           on lp.event_id = e.id
          and lp.user_id = v_uid
          and lp.disqualified_at is null
   where e.status in ('scheduled', 'live', 'locked')
     and now() <= coalesce(e.conversion_deadline_at, e.window_end_at)
     and case when p_event_id is not null
              then e.id = p_event_id
              else public._live_event_in_audience(e, v_uid, null, null)
         end
   order by (lp.user_id is not null) desc, (e.audience_mode = 'all') desc, e.window_start_at
   limit 1;

  return jsonb_build_object(
    'friends',         public._live_event_invitees(v_event.id, v_uid, false),
    'total',           (select count(*) from public.referrals r where r.referrer_id = v_uid),
    'converted_total', (select count(*) from public.referrals r
                         where r.referrer_id = v_uid and r.converted_at is not null),
    'event', case when v_event.id is null then null else jsonb_build_object(
      'event_id',            v_event.id,
      'invite_bonus_points', v_event.invite_bonus_points,
      'milestone_n',         v_event.invite_milestone_n,
      'milestone_bonus',     v_event.invite_milestone_bonus,
      'converted_for_event', (select count(*) from public.referrals r
                               where r.referrer_id = v_uid
                                 and r.event_id = v_event.id
                                 and r.converted_at is not null),
      'milestone_paid',      exists (select 1 from public.live_event_invite_milestones m
                                      where m.event_id = v_event.id and m.referrer_id = v_uid),
      'entry_gate_n',        v_event.entry_gate_n,
      'entry_gate_counting', v_event.entry_gate_counting,
      'gate_count',          public._live_event_gate_count(v_event.id, v_uid),
      'gate_met',            v_event.entry_gate_n <= 0
                             or public._live_event_gate_count(v_event.id, v_uid) >= v_event.entry_gate_n
    ) end
  );
end;
$$;

revoke all on function public.get_my_invite_progress(uuid) from public, anon;
grant execute on function public.get_my_invite_progress(uuid) to authenticated;

-- ── Pushes carry the slug so a tap opens THAT event's board ─────────────────
-- send-push-notification routes event_* taps to /(tabs)/league?event=<slug>
-- when the payload has one (the League tab already reads ?event=).
create or replace function public.notify_live_event_revealed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'shared_resolve_token';

  for r in
    select lp.user_id,
           res.rank,
           res.prize_label
      from public.live_event_participants lp
      left join public.live_event_results res
             on res.event_id = lp.event_id and res.user_id = lp.user_id
     where lp.event_id = new.id
       and lp.disqualified_at is null
  loop
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-resolve-token', v_token
      ),
      body := jsonb_build_object(
        'target_user_id', r.user_id,
        'type', 'event_results_revealed',
        'payload', jsonb_build_object(
          'event_id',    new.id,
          'event_slug',  new.slug,
          'event_name',  new.name,
          'rank',        r.rank,
          'prize_label', r.prize_label
        )
      ),
      timeout_milliseconds := 5000
    );
  end loop;
  return new;
exception when others then
  raise warning '[notify_live_event_revealed] %: %', new.slug, sqlerrm;
  return new;
end;
$$;

create or replace function public.live_event_send_pulse(p_event_id uuid, p_kind text, p_dry_run boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev    public.live_events;
  v_token text;
  v_n     integer := 0;
  r       record;
begin
  if p_kind not in ('rank', 'gate') then
    raise exception 'unknown pulse kind %', p_kind;
  end if;

  select * into v_ev from public.live_events where id = p_event_id;
  if not found or not public._live_event_pulse_ready(v_ev, p_kind) then
    return 0;
  end if;

  if not p_dry_run then
    select decrypted_secret into v_token
      from vault.decrypted_secrets where name = 'shared_resolve_token';
  end if;

  if p_kind = 'rank' then
    -- Audience = the board as the app shows it: same gate mode, same rank
    -- delta reference as the ▲/▼ arrows. Opt-in scope pushes every scored
    -- registrant (zero-pointers included — "you're #14 on 0" is the
    -- activation nudge); global scope only score > 0, never the whole
    -- member base tied at the bottom.
    for r in
      -- materialized: sc is referenced three times, and each inline copy
      -- would be its own full scorer pass over the ledger.
      with sc as materialized (
        select s.user_id, s.rank::int as rank, s.score
          from public._live_event_scores(v_ev.id, v_ev.entry_gate_mode = 'entry') s
      )
      select sc.user_id, sc.rank, sc.score,
             (d.prev_rank - sc.rank)::int as rank_delta,
             (nxt.score - sc.score)       as gap_above,
             case when sc.rank = 1
                  then sc.score - (select score from sc x where x.rank = 2)
             end                          as lead
        from sc
        left join public._live_event_rank_deltas(v_ev.id) d on d.user_id = sc.user_id
        left join sc nxt on nxt.rank = sc.rank - 1
       where (v_ev.scope = 'opt_in' or sc.score > 0)
       order by sc.rank
    loop
      v_n := v_n + 1;
      if not p_dry_run then
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-resolve-token', v_token
          ),
          body := jsonb_build_object(
            'target_user_id', r.user_id,
            'type', 'event_rank_daily',
            'payload', jsonb_build_object(
              'event_id',   v_ev.id,
              'event_slug', v_ev.slug,
              'event_name', v_ev.name,
              'rank',       r.rank,
              'points',     r.score,
              'rank_delta', r.rank_delta,
              'gap_above',  r.gap_above,
              'lead',       r.lead
            )
          ),
          timeout_milliseconds := 5000
        );
      end if;
    end loop;

  else  -- gate
    for r in
      select lp.user_id,
             public._live_event_gate_count(v_ev.id, lp.user_id) as gate_count
        from public.live_event_participants lp
       where lp.event_id = v_ev.id
         and lp.disqualified_at is null
    loop
      if r.gate_count >= v_ev.entry_gate_n then
        continue;  -- gate met — congratulating daily is noise, not a cue
      end if;
      v_n := v_n + 1;
      if not p_dry_run then
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-resolve-token', v_token
          ),
          body := jsonb_build_object(
            'target_user_id', r.user_id,
            'type', 'event_gate_reminder',
            'payload', jsonb_build_object(
              'event_id',    v_ev.id,
              'event_slug',  v_ev.slug,
              'event_name',  v_ev.name,
              'count',       r.gate_count,
              'required',    v_ev.entry_gate_n,
              'counting',    v_ev.entry_gate_counting,
              'gate_mode',   v_ev.entry_gate_mode,
              'deadline_at', public._live_event_gate_deadline(v_ev)
            )
          ),
          timeout_milliseconds := 5000
        );
      end if;
    end loop;
  end if;

  return v_n;
end;
$$;
