-- open_gym_visit: one live visit per user, enforced by the database.
--
-- FIELD-CAUGHT: the function did a SELECT ... LIMIT 1 and then an INSERT with no
-- lock, no arbiter and no constraint, so concurrent openers all miss the SELECT
-- and all INSERT. Two client paths open the same check-in
-- (GeofenceContext.handleGeofenceEntry ~1169 and heartbeatVisitStream's late-open
-- retry ~1509), and foreground + headless JS contexts can each run them.
-- Prod 2026-07-30: 30 of 74 visit rows were created within 5 s of another row for
-- the same user (26 of 50 on iOS, 4 of 24 on Android); one check-in produced THREE
-- rows 2 ms apart. The surplus rows absorbed 48 of the 229 wake pushes ever sent
-- (21%) — against Apple's ~2-3 background pushes/hour guidance — while the device
-- holds ONE visitId in AsyncStorage and the server nudges a different row.
--
-- TWO mechanisms, deliberately both:
--   1. pg_advisory_xact_lock per user — serialises read → close-lingering →
--      insert, so the second caller SEES the first caller's row and returns it.
--      This is what makes the RPC idempotent. SELECT ... FOR UPDATE cannot do
--      this job: in the observed race there is no row yet to lock.
--   2. a partial UNIQUE index — states the real invariant ("a user is in at most
--      one gym at a time") in the schema, so ANY writer that skips the lock still
--      cannot create a second live row, and gives ON CONFLICT an arbiter.
--      Verified: 0 overlapping visits at different partners have ever existed.
--
-- The 2026-07-15 behaviour is preserved exactly: a lingering claimed/upgraded
-- visit whose exit never fired is CLOSED (bounded at its last location-proven
-- moment) and a fresh visit opened, so the beacon sees the NEW session.
--
-- TRUST MODEL UNCHANGED: this function awards nothing and records nothing about
-- presence. "No fix, no credit" is untouched.

-- ---------------------------------------------------------------------------
-- 1. Pre-flight: collapse any surplus live rows so the index can be created.
-- ---------------------------------------------------------------------------
-- A no-op today (4 live rows / 4 distinct users, checked 2026-07-30). It exists
-- so the migration is deterministic if a duplicate burst lands between now and
-- apply. Keyed on "more than one row with ended_at is null", NOT on matching
-- started_at: observed bursts differ by 10-17 ms there. Keeper = the row with
-- the most credit history, i.e. the one the beacon and the device are working with.
with ranked as (
  select id,
         row_number() over (
           partition by user_id
           order by (claimed_at is not null)  desc,
                    (upgraded_at is not null) desc,
                    last_confirmed_at desc nulls last,
                    nudge_count desc,
                    started_at desc,
                    created_at asc
         ) as rn
    from public.gym_visits
   where ended_at is null
),
closed as (
  update public.gym_visits v
     set ended_at = coalesce(v.last_confirmed_at, v.started_at),
         status   = case when v.status = 'open' then 'closed' else v.status end
   where v.id in (select id from ranked where rn > 1)
  returning v.id, v.user_id
)
insert into public.gym_visit_events (visit_id, user_id, event, detail)
select id, user_id, 'closed_stale',
       jsonb_build_object('reason', 'duplicate_live_visit', 'by', 'migration')
  from closed;

-- ---------------------------------------------------------------------------
-- 2. The invariant.
-- ---------------------------------------------------------------------------
-- Partial, so closed/abandoned history stays unconstrained. A UNIQUE CONSTRAINT
-- cannot be partial, hence a unique index. Not CONCURRENTLY: migrations run in a
-- transaction, and the table is ~74 rows.
create unique index if not exists gym_visits_one_live_per_user_idx
  on public.gym_visits (user_id)
  where ended_at is null;

comment on index public.gym_visits_one_live_per_user_idx is
  'A user can be in at most one gym at a time: at most one gym_visits row per user with ended_at is null. Also the ON CONFLICT arbiter for open_gym_visit — dropping this index makes that RPC fail with 42P10.';

-- ---------------------------------------------------------------------------
-- 3. The function.
-- ---------------------------------------------------------------------------
create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id  text,
  p_started_at timestamp with time zone,
  p_platform   text default null::text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user   uuid := auth.uid();
  v_id     uuid;
  v_status text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  -- Serialise every open for THIS user. Taken BEFORE the read, so the loser's
  -- SELECT below runs on a snapshot that already contains the winner's row
  -- (READ COMMITTED: each statement takes a fresh snapshot). Released at commit;
  -- other users are unaffected.
  perform pg_advisory_xact_lock(hashtextextended('open_gym_visit:' || v_user::text, 0));

  select id, status into v_id, v_status
    from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc
   limit 1;

  -- Same live session double-opening (racing check-in paths) — re-use it.
  if v_id is not null and v_status = 'open' then return v_id; end if;

  -- Finished-but-never-exited visit (2026-07-15): close it so the beacon sees the
  -- NEW session. ended_at is bounded by the last location-proven presence. The
  -- `ended_at is null` predicate + `if found` keep a re-run from overwriting a
  -- close somebody else just made, or logging a second closed_stale row.
  if v_id is not null then
    update gym_visits
       set ended_at = coalesce(last_confirmed_at, started_at)
     where id = v_id and ended_at is null;

    if found then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'closed_stale', jsonb_build_object('reason', 'superseded_by_new_check_in'));
    end if;
    v_id := null;
  end if;

  -- Bounded at two attempts, so this can never spin.
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

    -- Only reachable from a writer that did not hold our lock: it now owns the
    -- one live slot. ADOPT its row rather than returning NULL — a NULL means the
    -- device has no visit id at all, so the beacon can never wake it, which is
    -- strictly worse than the duplicate this migration removes. No check_in event
    -- here: the winner already logged one for that row. The predicate matches the
    -- INDEX predicate exactly (no status filter), so whatever occupies the slot
    -- is always found and the loop terminates.
    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then return v_id; end if;
    -- The winner's row was closed in the gap; the slot is free again — retry once.
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL (anon was revoked in 20260727153603).
-- Re-asserted defensively — `from public, anon` does not touch service_role's grant.
revoke all on function public.open_gym_visit(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.open_gym_visit(uuid, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Hardening: the definer RPCs are the only client write path, in fact as
--    well as in intent.
-- ---------------------------------------------------------------------------
-- anon/authenticated held table-level INSERT/UPDATE/DELETE with only the absence
-- of a write RLS policy blocking them — the one route by which a future change
-- could bypass the advisory lock. The definer RPCs run as owner; the edge
-- functions use service_role. SELECT stays — the RLS read policies need it.
revoke insert, update, delete, truncate on table public.gym_visits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Vault idempotency arbiter (for upgrade-gym-tier's new overflow deposit).
-- ---------------------------------------------------------------------------
-- claim-points writes at most one cap_overflow deposit per session (guarded by
-- claim idempotency), but upgrade-gym-tier has no earn-row arbiter on its
-- vault-only path — two concurrent upgrades could both deposit. Same pattern as
-- point_transactions' (session_id, description) index: the DB is the backstop,
-- 23505 = already banked, treat as no-op. Partial: admin grants / level-ups have
-- no session and stay unconstrained. Verified 0 existing duplicate pairs.
create unique index if not exists vault_deposits_session_desc_uidx
  on public.vault_deposits (session_id, description)
  where session_id is not null;
