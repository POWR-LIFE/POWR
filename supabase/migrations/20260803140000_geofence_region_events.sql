-- Region-crossing telemetry — the check-in path's missing wake_received.
--
-- 2026-08-03: after a walk-out/walk-back-in test, NEITHER platform re-checked in
-- while backgrounded (Android and iOS both silent; both only checked in when the
-- app was opened). The exits landed server-side, so the regions were armed — but
-- the ENTER branch of the geofence task makes ZERO server calls, so these are
-- indistinguishable from the outside:
--     (a) the OS never delivered the region ENTER
--     (b) ENTER fired and the approach stream never produced an inside fix
-- This is exactly the blind spot that hid the dead iOS wake path for 17 days
-- (see log_gym_wake_received). Same remedy: log the moment the event reaches JS,
-- before any work that can fail.
--
-- Deliberately its own table rather than gym_visit_events: these fire BEFORE a
-- visit exists (that is the whole point), and gym_visit_events.visit_id is NOT NULL.

create table if not exists public.geofence_region_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  region_id  text not null,
  event      text not null,          -- 'enter' | 'exit' | 'approach_stream_on' | 'checked_in'
  platform   text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists geofence_region_events_user_time_idx
  on public.geofence_region_events (user_id, created_at desc);

alter table public.geofence_region_events enable row level security;

-- Owners read their own; admins read everything (mirrors the gym_visit_events model).
drop policy if exists geofence_region_events_select_own on public.geofence_region_events;
create policy geofence_region_events_select_own
  on public.geofence_region_events for select
  using (user_id = auth.uid());

drop policy if exists geofence_region_events_select_admin on public.geofence_region_events;
create policy geofence_region_events_select_admin
  on public.geofence_region_events for select
  using (public.is_admin());

-- Writes go through the definer RPC only.
revoke insert, update, delete on public.geofence_region_events from anon, authenticated;

create or replace function public.log_geofence_region_event(
  p_region_id text,
  p_event     text,
  p_platform  text default null,
  p_detail    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user uuid := auth.uid();
begin
  -- A region crossing can land mid-auth-refresh, and this is telemetry riding on
  -- a background task's tight execution window: silence beats an exception.
  if v_user is null then return; end if;
  insert into public.geofence_region_events (user_id, region_id, event, platform, detail)
  values (v_user, left(coalesce(p_region_id, ''), 200), left(coalesce(p_event, 'unknown'), 40), p_platform, coalesce(p_detail, '{}'::jsonb));
end;
$function$;

revoke all on function public.log_geofence_region_event(text, text, text, jsonb) from public, anon;
grant execute on function public.log_geofence_region_event(text, text, text, jsonb) to authenticated, service_role;
