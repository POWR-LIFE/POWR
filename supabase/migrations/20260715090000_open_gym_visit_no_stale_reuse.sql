-- open_gym_visit: never resurrect a finished visit.
--
-- FIELD-CAUGHT 2026-07-15 morning: a session claimed+upgraded the previous
-- evening whose EXIT never fired (the phone left the gym dozing, so the frozen
-- stream never delivered the exit fix) stays `upgraded` with ended_at null.
-- The next morning's check-in re-used that visit — and the beacon's dueVisits
-- only nudges `open` (dwell stage) and `claimed` (upgrade stage), so the new
-- session got ZERO wakes: no background claim, no pushes, regardless of client
-- version. The 12 h abandon cron is too slow to help a same-day return.
--
-- Fix: only a genuinely LIVE (`open`) visit is re-usable dedupe territory. A
-- lingering claimed/upgraded visit has finished its credit story — close it at
-- its last location-proven moment and open a fresh visit for the new session.
-- A duplicate claim attempt for the fresh visit is absorbed by the existing
-- idempotency (day-unique session index + already-claimed pre-checks).

create or replace function public.open_gym_visit(p_partner_id uuid, p_region_id text, p_started_at timestamp with time zone, p_platform text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
  v_status text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select id, status into v_id, v_status from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc limit 1;

  -- Same live session double-opening (racing check-in paths) — re-use it.
  if v_id is not null and v_status = 'open' then return v_id; end if;

  -- Finished-but-never-exited visit: close it so the beacon sees the NEW
  -- session. ended_at is bounded by the last location-proven presence.
  if v_id is not null then
    update gym_visits
       set ended_at = coalesce(last_confirmed_at, started_at)
     where id = v_id;
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (v_id, v_user, 'closed_stale', jsonb_build_object('reason', 'superseded_by_new_check_in'));
  end if;

  insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
  values (v_user, p_partner_id, p_region_id, coalesce(p_started_at, now()), p_platform)
  returning id into v_id;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (v_id, v_user, 'check_in', jsonb_build_object('region_id', p_region_id));

  return v_id;
end;
$$;
