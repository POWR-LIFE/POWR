-- BACKFILLED FROM PRODUCTION (2026-08-18). This trigger was applied live on
-- 2026-08-17 via apply_migration and the file was never committed, so
-- `supabase/migrations` could no longer rebuild the database: a fresh apply
-- produced a schema with no client-session-window guard at all. The body below
-- is pg_get_functiondef output from the live database, verbatim.
--
-- WHAT IT GUARDS. The client's session reconciler read its own last write and
-- ratcheted a gym session's window on every pass. The server owns the truth, so
-- a client UPDATE may recover late DETECTION (up to a 5-minute entry margin) and
-- may never shrink an exit below presence the server actually PROVED.
--
-- ⚠ IT MUTATES `new` RATHER THAN RAISING — the clamp is silent by design (a wake
-- that answers with a slightly wrong window must still land), so a client cannot
-- tell its write was corrected. Anything debugging "my duration did not change"
-- should look here first.

create or replace function public.guard_client_session_window()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role    text := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role';
  v_checkin timestamptz;
  v_proof   timestamptz;
begin
  -- The server owns the truth. A null role is direct SQL (psql / MCP repair).
  if v_role is null or v_role = 'service_role' or public.is_admin() then
    return new;
  end if;

  if old.type = 'gym' and old.verification = 'geofence' then
    select v.started_at,
           coalesce(v.last_proven_at, v.last_confirmed_at, v.ended_at)
      into v_checkin, v_proof
      from gym_visits v
     where v.claimed_session_id = old.id
     order by v.started_at desc
     limit 1;

    -- ENTRY: a client may recover LATE DETECTION (up to the 5-minute margin) and no
    -- more. An ABSOLUTE floor, so N passes cannot ratchet further than one pass —
    -- that is what killed the morning row.
    new.started_at := greatest(
      new.started_at,
      coalesce(v_checkin - interval '5 minutes', old.started_at)
    );

    -- EXIT: never earlier than presence the server actually PROVED, and never
    -- earlier than it already is. 13:19:34 losing to a location-confirmed fix at
    -- 14:00:09 is the whole incident.
    new.ended_at := greatest(
      coalesce(new.ended_at, old.ended_at),
      coalesce(old.ended_at, new.ended_at),
      coalesce(v_proof, old.ended_at)
    );

    -- The duration must agree with the window it claims, and never shrink. 12 h cap
    -- mirrors MAX_GYM_SESSION_SEC.
    new.duration_sec := least(43200, greatest(
      coalesce(new.duration_sec, 0),
      coalesce(old.duration_sec, 0),
      extract(epoch from (new.ended_at - new.started_at))::int
    ));
  end if;

  return new;
end $function$;

drop trigger if exists trg_guard_client_session_window on public.activity_sessions;
create trigger trg_guard_client_session_window
  before update on public.activity_sessions
  for each row execute function public.guard_client_session_window();
