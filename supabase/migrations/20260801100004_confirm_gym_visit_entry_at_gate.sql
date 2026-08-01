-- confirm_gym_visit_v2: gate the credit on the DEVICE's entry time as well as the
-- visit row's.
--
-- LATENT, zero occurrences to date — all 20 relay credit events in history have
-- crossed_utc_day = false. This is defence in depth behind the reuse bound shipped
-- in 20260801100001, not a live incident.
--
-- THE SHAPE OF IT. The function derives BOTH the dwell decision and the target
-- session's day from v_visit.started_at alone, and the client passes
-- p_request_credit = inside with no local dwell check of its own
-- (GeofenceContext.tsx runVisitCheck). So if a device is ever bound to a visit row
-- that started long before its actual check-in — exactly what the unbounded reuse
-- branch used to do — a wake answered one minute into a real session would satisfy
-- `v_elapsed_min >= v_dwell_min` immediately and credit a session dated to the
-- stale row's day. The device is the only party that knows when the user actually
-- arrived, so it should have to agree.
--
-- least() ignores NULL, so a caller that passes no p_entry_at gets EXACTLY the old
-- behaviour. That keeps every client on the current OTA working unchanged.
--
-- Deliberately NOT refusing on "different UTC day": legitimate long and overnight
-- sessions already exist in prod (a 407-minute same-day relay upgrade among them),
-- and rejecting them would destroy real credits to prevent a hypothetical one.
--
-- Signature change is drop-then-create inside one transaction (a bare CREATE OR
-- REPLACE with a new parameter list would leave TWO overloads and make the
-- PostgREST call ambiguous).

drop function if exists public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean);

create or replace function public.confirm_gym_visit_v2(
  p_visit_id       uuid,
  p_inside         boolean,
  p_detail         jsonb default '{}'::jsonb,
  p_request_credit boolean default false,
  p_entry_at       timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit from gym_visits where id = p_visit_id and user_id = v_user;
  if not found then raise exception 'visit not found'; end if;

  update gym_visits
     set last_confirmed_at = case when p_inside then now() else last_confirmed_at end
   where id = p_visit_id and user_id = v_user;

  -- Written unconditionally, before any credit branch: this row is the ONLY proof
  -- that a silent wake reached the device's JS. Do not move it below a guard.
  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          coalesce(p_detail, '{}'::jsonb));

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
      -- Already claimed by another path. The claim is REAL, it just wasn't ours.
      -- Leaving the visit 'open' is what starved the upgrade stage (which keys on
      -- status='claimed') and orphaned the row for the next day's check-in.
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
      -- Upgrade already paid, or the session was claimed at the 40-min tier
      -- outright (the common case for an exit claim scored off full duration).
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
$function$;

-- DROP discards the old ACL and a fresh function grants EXECUTE to PUBLIC by
-- default, so the pre-drop grants must be restored explicitly. Captured before the
-- change: {postgres=X, authenticated=X, service_role=X}, anon revoked.
revoke all on function public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean, timestamptz) from public;
revoke all on function public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean, timestamptz) from anon;
grant execute on function public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean, timestamptz) to authenticated;
grant execute on function public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean, timestamptz) to service_role;
