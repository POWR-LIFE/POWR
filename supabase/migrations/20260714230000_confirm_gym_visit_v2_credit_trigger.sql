-- confirm_gym_visit_v2: the presence confirm carries the credit trigger.
--
-- WHY: the 2026-07-14 evening field run proved the radio window a high-priority
-- FCM wake grants a dozing Android app fits roughly ONE round-trip. The confirm
-- RPC landed 4/4 (each within ~2 s of the beacon nudge); the claim chain queued
-- behind it (session insert-dedup → relay RPC) starved every single time, so
-- points still only landed on app-open. This function makes the device's one
-- guaranteed round-trip do double duty: record the location-proven confirm AND
-- have the SERVER resolve the session and relay claim-points / upgrade-gym-tier
-- via pg_net (server-to-server, immune to Doze).
--
-- TRUST MODEL UNCHANGED ("no fix, no credit"): the credit trigger only fires on
-- p_inside = true, i.e. the device just proved presence with a fresh/cached fix
-- against the partner radius in THIS request. The server decides claim vs
-- upgrade from the visit's own status + elapsed time + system_config thresholds
-- — client-side threshold drift can't fire anything early, and claim-points /
-- upgrade-gym-tier keep every award gate. If the client's session INSERT never
-- landed (the starvation case), the row is created here from the visit's own
-- server-side timestamps — the same values the client insert would have used —
-- and the client's in-flight insert dedups against it (unique
-- idx_one_session_per_type_per_day).
--
-- The v1 confirm_gym_visit stays for older clients.

create or replace function public.confirm_gym_visit_v2(
  p_visit_id uuid,
  p_inside boolean,
  p_detail jsonb default '{}'::jsonb,
  p_request_credit boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit from gym_visits where id = p_visit_id and user_id = v_user;
  if not found then raise exception 'visit not found'; end if;

  update gym_visits
     set last_confirmed_at = case when p_inside then now() else last_confirmed_at end
   where id = p_visit_id and user_id = v_user;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          coalesce(p_detail, '{}'::jsonb));

  if not (p_inside and p_request_credit) then
    return jsonb_build_object('triggered', null);
  end if;

  -- Same source of truth as the beacon and the edge functions.
  begin
    v_dwell_min := coalesce((select value from system_config where key = 'min_gym_dwell_minutes')::int, 30);
  exception when others then v_dwell_min := 30;
  end;
  begin
    v_upgrade_min := coalesce((select value from system_config where key = 'gym_upgrade_minutes')::int, 40);
  exception when others then v_upgrade_min := 40;
  end;

  v_elapsed_min := extract(epoch from (now() - v_visit.started_at)) / 60;

  if v_visit.status = 'open' and v_elapsed_min >= v_dwell_min then
    -- Resolve (or create) the session for this visit's UTC day. The client
    -- usually inserted it already; when it didn't, this row carries the visit's
    -- own server-side entry time, so the duration can't be inflated.
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
        -- Lost the race to the client's own insert — use theirs.
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
    end if;
  end if;

  return jsonb_build_object('triggered', v_triggered, 'session_id', v_session_id, 'request_id', v_req);
end;
$$;

revoke all on function public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean) from public, anon;
grant execute on function public.confirm_gym_visit_v2(uuid, boolean, jsonb, boolean) to authenticated;
