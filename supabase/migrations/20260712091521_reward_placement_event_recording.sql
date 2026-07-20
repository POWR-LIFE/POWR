-- =============================================================
-- REWARD PLACEMENTS -> resolver-validated funnel events
-- =============================================================
-- Event rows are commercial measurement data. A client must not be able to
-- name any placement ID and insert a surfaced/presence/notified event. The
-- calls below validate that the placement resolves for the authenticated user
-- at the supplied location and local time before writing a bounded event.
-- =============================================================

drop policy if exists "Users log their own placement events" on public.reward_placement_events;

create or replace function public.resolve_reward_placements_and_record(
  p_lat double precision,
  p_lng double precision,
  p_local_dow smallint,
  p_local_hour smallint,
  p_record_surface boolean default false,
  p_confirm_presence boolean default false
)
returns table (
  placement_id uuid,
  reward_id uuid,
  visibility text,
  priority integer,
  paid boolean,
  partner_id uuid,
  distance_m double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_resolved record;
begin
  if v_user_id is null then return; end if;

  -- A placement visit is low-frequency but can arrive from a foreground watch
  -- and background task at once. Serialising per user avoids duplicate funnel
  -- rows during that overlap without globally blocking other members.
  if p_record_surface or p_confirm_presence then
    perform pg_advisory_xact_lock(hashtext('reward_placement_event:' || v_user_id::text));
  end if;

  for v_resolved in
    select *
    from public.resolve_reward_placements(p_lat, p_lng, p_local_dow, p_local_hour)
  loop
    if p_record_surface and not exists (
      select 1
      from public.reward_placement_events event
      where event.placement_id = v_resolved.placement_id
        and event.user_id = v_user_id
        and event.event_type = 'surfaced'
        and event.created_at > now() - interval '30 minutes'
    ) then
      insert into public.reward_placement_events (placement_id, user_id, event_type, lat, lng)
      values (v_resolved.placement_id, v_user_id, 'surfaced', p_lat, p_lng);
    end if;

    if p_confirm_presence and not exists (
      select 1
      from public.reward_placement_events event
      where event.placement_id = v_resolved.placement_id
        and event.user_id = v_user_id
        and event.event_type = 'presence_confirmed'
        and event.created_at > now() - interval '30 minutes'
    ) then
      insert into public.reward_placement_events (placement_id, user_id, event_type, lat, lng)
      values (v_resolved.placement_id, v_user_id, 'presence_confirmed', p_lat, p_lng);
    end if;

    placement_id := v_resolved.placement_id;
    reward_id := v_resolved.reward_id;
    visibility := v_resolved.visibility;
    priority := v_resolved.priority;
    paid := v_resolved.paid;
    partner_id := v_resolved.partner_id;
    distance_m := v_resolved.distance_m;
    return next;
  end loop;
end;
$$;

revoke all on function public.resolve_reward_placements_and_record(double precision, double precision, smallint, smallint, boolean, boolean) from public, anon;
grant execute on function public.resolve_reward_placements_and_record(double precision, double precision, smallint, smallint, boolean, boolean) to authenticated;

create or replace function public.record_placement_notification(
  p_placement_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_local_dow smallint,
  p_local_hour smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then return false; end if;
  if not exists (
    select 1
    from public.resolve_reward_placements(p_lat, p_lng, p_local_dow, p_local_hour) resolved
    where resolved.placement_id = p_placement_id
  ) then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('reward_placement_notification:' || v_user_id::text || ':' || p_placement_id::text));

  if exists (
    select 1
    from public.reward_placement_events event
    where event.placement_id = p_placement_id
      and event.user_id = v_user_id
      and event.event_type = 'notified'
      and event.created_at > now() - interval '6 hours'
  ) then
    return false;
  end if;

  insert into public.reward_placement_events (placement_id, user_id, event_type, lat, lng)
  values (p_placement_id, v_user_id, 'notified', p_lat, p_lng);
  return true;
end;
$$;

revoke all on function public.record_placement_notification(uuid, double precision, double precision, smallint, smallint) from public, anon;
grant execute on function public.record_placement_notification(uuid, double precision, double precision, smallint, smallint) to authenticated;