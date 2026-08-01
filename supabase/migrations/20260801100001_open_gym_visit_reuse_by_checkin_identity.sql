-- Refines 20260801100000: match the reuse on check-in IDENTITY, not on age.
--
-- WHY THE AGE WINDOW ISN'T ENOUGH. Replaying all 9 historical stale reuses against
-- the 4-hour window from the previous migration:
--
--   visit      age at reuse   status     rejected by
--   802d18be   750 min        abandoned  age + status
--   e3eed202   704 min        abandoned  age + status   (Yan26, crossed gyms)
--   793e434a   680 min        closed     age + status
--   81ff3551   608 min        closed     age + status
--   9caa850e   581 min        closed     age + status
--   04f69898   580 min        closed     age + status
--   d3ce3011   413 min        abandoned  age + status
--   842b0d6e   306 min        abandoned  age + status
--   2fa4e05d   198 min        upgraded   status ONLY  <-- inside the 4h window
--
-- 2fa4e05d survives the age test. It happened to be 'upgraded' so it was rejected
-- anyway, but that is luck, not design: an `open` row 3 hours old — a user who left
-- after ten minutes and whose EXIT never fired, which is 55 of 83 visits — would be
-- reused, would already be nudge-capped, and would reproduce the outage at a
-- smaller scale. Widening or narrowing the window just moves the cliff.
--
-- THE RIGHT QUESTION. Both legitimate callers pass the SAME entryTimestamp for a
-- given session:
--   setActiveAndNotify        (GeofenceContext.tsx:1170) — the value it just wrote
--                                                          to ACTIVE_GEOFENCE_KEY
--   heartbeatVisitStream      (GeofenceContext.tsx:1510) — that same stored value,
--                                                          replayed on late-open
-- So the caller always tells us WHICH check-in it means, and we can compare it to
-- the row's own started_at instead of guessing from elapsed time. Yesterday's row
-- cannot match today's entryTimestamp at any age, which is the property the age
-- window was only approximating. The ±5 min tolerance absorbs clock jitter; it is
-- the same device clock on both calls, so in practice the values are identical.
--
-- The 4-hour ceiling is KEPT as a backstop for a caller that passes no started_at
-- (coalesce(p_started_at, now()) would otherwise make a stale row look current).
--
-- Everything else about the function is unchanged from 20260801100000.

create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id  text,
  p_started_at timestamptz,
  p_platform   text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Identity of the check-in the caller is describing. Load-bearing test.
  c_same_checkin constant interval := interval '5 minutes';
  -- Backstop for a caller that passes no started_at at all.
  c_reuse_window constant interval := interval '4 hours';
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_status     text;
  v_started_at timestamptz;
  v_partner_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  perform pg_advisory_xact_lock(hashtextextended('open_gym_visit:' || v_user::text, 0));

  select id, status, started_at, partner_id
    into v_id, v_status, v_started_at, v_partner_id
    from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc
   limit 1;

  -- Re-use ONLY the row that is this very check-in, still live, at this gym.
  --   status   — a claimed/upgraded row is a finished session, never a live one
  --   identity — the row's started_at must BE the check-in the caller describes
  --   age      — backstop when the caller passed no started_at
  --   partner  — Yan26's 07-31 reuse crossed gyms, which would let
  --              confirm_gym_visit_v2 later credit a session at a gym she was
  --              never in. `is not distinct from` so a null/null pair matches.
  if v_id is not null
     and v_status = 'open'
     and v_started_at > now() - c_reuse_window
     and v_partner_id is not distinct from p_partner_id
     and v_started_at between coalesce(p_started_at, now()) - c_same_checkin
                          and coalesce(p_started_at, now()) + c_same_checkin
  then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (v_id, v_user, 'reused', jsonb_build_object(
      'region_id', p_region_id,
      'age_min',   round(extract(epoch from (now() - v_started_at)) / 60)
    ));
    return v_id;
  end if;

  -- Anything else live — finished-but-never-exited (2026-07-15), or belonging to a
  -- different check-in / different gym — is CLOSED so the beacon sees the NEW
  -- session. ended_at is bounded by the last location-proven presence.
  if v_id is not null then
    update gym_visits
       set ended_at     = coalesce(last_confirmed_at, started_at),
           status       = 'closed',
           close_reason = 'superseded_by_new_check_in'
     where id = v_id and ended_at is null;

    if found then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'closed_stale', jsonb_build_object(
        'reason',          'superseded_by_new_check_in',
        'prior_status',    v_status,
        'age_min',         round(extract(epoch from (now() - v_started_at)) / 60),
        'partner_changed', (v_partner_id is distinct from p_partner_id)
      ));
    end if;
    v_id := null;
  end if;

  for attempt in 1..2 loop
    insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
    values (v_user, p_partner_id, p_region_id, coalesce(p_started_at, now()), p_platform)
    on conflict (user_id) where ended_at is null do nothing
    returning id into v_id;

    if v_id is not null then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'check_in', jsonb_build_object('region_id', p_region_id));
      return v_id;
    end if;

    -- Only reachable from a writer that did not hold our lock: it now owns the one
    -- live slot. ADOPT its row rather than returning NULL — a NULL means the device
    -- has no visit id at all, so the beacon can never wake it, which is strictly
    -- worse than the duplicate this guards against.
    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then return v_id; end if;
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$function$;
