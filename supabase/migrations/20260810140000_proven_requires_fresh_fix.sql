-- v_proven must consider WHEN the fix was true, not only how precise it was.
--
-- Field 2026-08-10 12:45:02Z, Android visit 95a96e93: confirm_gym_visit_v2 stamped
-- last_proven_at on accuracy_m 28 / distance_m 18 — four minutes after the owner
-- walked out, from a stream-cache fix that was already 219 s old. The iPhone in the
-- same pocket read 193 m at that instant. The event even carried
-- trace.stream_fix_age_s = 219 beside the verdict; nothing consulted it.
--
-- Consequences of that one stamp:
--   • the reaper's 45-minute silence clock restarted from a dishonest moment,
--     pushing the deadline from 13:14Z out to 13:30Z;
--   • ended_at would have been 12:45:02 for a visit that truly ended ~12:41.
--
-- Mirrors lib/health/gymPresence.ts MAX_CREDIT_FIX_AGE_MS (120 s) exactly. The
-- client sends detail.fix_age_s from 2026-08-10 onward; older bundles send NULL,
-- and NULL stays acceptable so this cannot retroactively refuse credit on phones
-- that never take the OTA — same compatibility rule as fix_trusted.
--
-- ⚠ `inside` and last_confirmed_at are deliberately UNCHANGED. Strict to credit,
-- loose to close: a stale fix must still hold a live session open (refusing coarse
-- fixes there starved entire dwells on 2026-07-03 and 07-11); it just must not pay.

create or replace function public.confirm_gym_visit_v2(
  p_visit_id uuid,
  p_inside boolean,
  p_detail jsonb default '{}'::jsonb,
  p_request_credit boolean default false,
  p_entry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_visit gym_visits%rowtype;
  v_dwell_min int := 30;
  v_upgrade_min int := 40;
  v_elapsed_min numeric;
  v_session_id uuid;
  v_req bigint;
  v_triggered text := null;
  v_declined text := null;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_radius numeric;
  v_distance numeric;
  v_accuracy numeric;
  v_fix_age_s numeric;
  v_proven boolean := false;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit from gym_visits where id = p_visit_id and user_id = v_user;
  if not found then raise exception 'visit not found'; end if;

  -- Would this fix justify BILLING the time up to now, as opposed to merely keeping
  -- the session open? Mirrors fixCreditsPresence exactly: trusted fix, venue inside
  -- the fix's own error bar, AND the fix young enough to describe the present. The
  -- 50 m hysteresis band is NOT admitted — it damps oscillation, it does not
  -- describe where anybody is.
  v_radius   := _gym_visit_radius_m(v_visit.partner_id, v_visit.region_id);
  v_distance := _gym_detail_num(v_detail, 'distance_m');
  v_accuracy := _gym_detail_num(v_detail, 'accuracy_m');
  v_fix_age_s := _gym_detail_num(v_detail, 'fix_age_s');
  v_proven := p_inside
          and coalesce((v_detail ->> 'fix_trusted')::boolean, false)
          and v_distance is not null
          and v_distance <= v_radius + coalesce(v_accuracy, 0)
          and (v_fix_age_s is null or v_fix_age_s <= 120);

  update gym_visits
     set last_confirmed_at = case when p_inside  then now() else last_confirmed_at end,
         last_proven_at    = case when v_proven  then now() else last_proven_at    end
   where id = p_visit_id and user_id = v_user;

  -- Written unconditionally, before any credit branch: the ONLY proof a silent wake
  -- reached the device's JS. Do not move it below a guard. `proven` rides along so
  -- the answer is queryable after the fact.
  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          v_detail || jsonb_build_object('proven', v_proven, 'radius_m', v_radius));

  if not (p_inside and p_request_credit) then
    return jsonb_build_object('triggered', null);
  end if;

  begin
    v_dwell_min := coalesce((select value from system_config where key = 'min_gym_dwell_minutes')::int, 30);
  exception when others then v_dwell_min := 30;
  end;
  begin
    v_upgrade_min := coalesce((select value from system_config where key = 'gym_upgrade_minutes')::int, 40);
  exception when others then v_upgrade_min := 40;
  end;

  -- BOTH clocks must agree the threshold has passed. For older clients that send no
  -- p_entry_at, fall back to the visit row's started_at (legacy behaviour).
  v_elapsed_min := extract(epoch from (now() - v_visit.started_at)) / 60;
  if p_entry_at is not null then
    v_elapsed_min := least(
      v_elapsed_min,
      extract(epoch from (now() - p_entry_at)) / 60
    );
  end if;

  if v_visit.status = 'open' and v_elapsed_min >= v_dwell_min then
    select id into v_session_id
      from activity_sessions
     where user_id = v_user and type = 'gym' and verification = 'geofence'
       and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
     order by started_at desc
     limit 1;

    if v_session_id is null then
      insert into activity_sessions
        (user_id, type, started_at, ended_at, duration_sec, verification, trust_score, partner_id, raw_gps)
      values
        (v_user, 'gym', v_visit.started_at, now(),
         least(extract(epoch from (now() - v_visit.started_at))::int, 12 * 60 * 60),
         'geofence', 0.94, v_visit.partner_id,
         jsonb_build_object(
           'partnerId', v_visit.partner_id,
           'entryTimestamp', (extract(epoch from v_visit.started_at) * 1000)::bigint,
           'createdBy', 'confirm_gym_visit_v2'))
      on conflict do nothing
      returning id into v_session_id;

      if v_session_id is null then
        select id into v_session_id
          from activity_sessions
         where user_id = v_user and type = 'gym' and verification = 'geofence'
           and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
         order by started_at desc
         limit 1;
      end if;
    end if;

    if v_session_id is not null and not exists (
      select 1 from point_transactions where session_id = v_session_id and type = 'earn'
    ) then
      select net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/claim-points',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
        ),
        body := jsonb_build_object('session_id', v_session_id, 'user_id', v_user, 'visit_id', p_visit_id)
      ) into v_req;
      v_triggered := 'claim';

    elsif v_session_id is not null then
      v_declined := 'already_claimed';
      update gym_visits
         set status             = 'claimed',
             claimed_session_id = coalesce(claimed_session_id, v_session_id),
             claimed_at         = coalesce(claimed_at, now())
       where id = p_visit_id and user_id = v_user and status = 'open';
    end if;

  elsif v_visit.status = 'claimed' and v_elapsed_min >= v_upgrade_min then
    v_session_id := v_visit.claimed_session_id;
    if v_session_id is null then
      select id into v_session_id
        from activity_sessions
       where user_id = v_user and type = 'gym' and verification = 'geofence'
         and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
       order by started_at desc
       limit 1;
    end if;

    if v_session_id is not null and not exists (
      select 1 from point_transactions
      where session_id = v_session_id and type = 'earn' and description like 'gym session upgrade%'
    ) then
      select net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/upgrade-gym-tier',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
        ),
        body := jsonb_build_object('session_id', v_session_id, 'user_id', v_user, 'visit_id', p_visit_id)
      ) into v_req;
      v_triggered := 'upgrade';

    elsif v_session_id is not null then
      v_declined := 'already_upgraded';
      update gym_visits
         set status      = 'upgraded',
             upgraded_at = coalesce(upgraded_at, now())
       where id = p_visit_id and user_id = v_user and status = 'claimed';
    end if;
  end if;

  if v_declined is not null then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, 'credit_declined', jsonb_build_object(
      'reason',      v_declined,
      'session_id',  v_session_id,
      'elapsed_min', round(v_elapsed_min)
    ));
  end if;

  return jsonb_build_object(
    'triggered',  v_triggered,
    'declined',   v_declined,
    'session_id', v_session_id,
    'request_id', v_req
  );
end;
$$;
