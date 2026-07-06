-- =============================================================
-- REWARD PLACEMENTS → atomic cells+schedule save, serialized conflicts
-- =============================================================
-- Two hardening fixes for the no-double-booking guarantee:
--
-- 1. RACE: set_placement_cells was check-then-insert with no serialization,
--    so two concurrent saves (e.g. two brands booking the same square at the
--    same moment) could both pass the conflict scan and both land overlapping
--    cells. An advisory xact lock now serializes all cell writes — coarse,
--    but cell writes are rare admin/brand actions.
--
-- 2. NON-ATOMIC SAVE: the editors updated the placement row (new dates /
--    week_mask) BEFORE calling set_placement_cells. On CELL_CONFLICT the row
--    kept its widened schedule while its old cells stayed put — leaving the
--    DB double-booked until someone re-saved. set_placement_cells now
--    optionally takes the schedule (p_schedule jsonb) and applies it in the
--    SAME transaction as the conflict check + cell replace: a conflict rolls
--    the schedule back with everything else, so the invariant can't be
--    violated half-way.
--
-- p_schedule keys (values may be null = clear): starts_at, ends_at,
-- week_mask (168-char '0'/'1' string), active_days (int array),
-- active_hour_start, active_hour_end. p_schedule = null keeps the legacy
-- behaviour: validate against the placement's stored schedule (used on
-- create, where the row was just inserted with its final schedule).
-- =============================================================

drop function if exists public.set_placement_cells(uuid, integer[]);

create function public.set_placement_cells(
  p_placement_id uuid,
  p_cells        integer[],              -- flat [z1,x1,y1, z2,x2,y2, ...]
  p_schedule     jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward uuid;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_mask   bit(168);
  v_days   smallint[];
  v_conflicts text;
  v_count  integer;
begin
  select reward_id, starts_at, ends_at, coalesce(week_mask, (repeat('1',168))::bit(168))
    into v_reward, v_starts, v_ends, v_mask
  from public.reward_placements where id = p_placement_id;
  if not found then raise exception 'PLACEMENT_NOT_FOUND'; end if;

  if not (
    exists (select 1 from public.admin_roles where user_id = auth.uid())
    or public.user_owns_reward_brand(v_reward)
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Serialize all cell writes: the conflict scan below is check-then-insert,
  -- and two concurrent saves must never both pass it.
  perform pg_advisory_xact_lock(hashtext('reward_placement_cells'));

  -- Apply the new schedule (when provided) BEFORE the conflict check so the
  -- check runs against what will actually be live. A CELL_CONFLICT aborts the
  -- whole function, rolling this update back with it.
  if p_schedule is not null then
    v_starts := (p_schedule->>'starts_at')::timestamptz;
    v_ends   := (p_schedule->>'ends_at')::timestamptz;
    v_mask   := coalesce(nullif(p_schedule->>'week_mask', ''), repeat('1',168))::bit(168);
    if jsonb_typeof(p_schedule->'active_days') = 'array' then
      select array_agg(d.x::smallint) into v_days
      from jsonb_array_elements_text(p_schedule->'active_days') as d(x);
    else
      v_days := null;
    end if;

    update public.reward_placements set
      starts_at         = v_starts,
      ends_at           = v_ends,
      week_mask         = nullif(p_schedule->>'week_mask', '')::bit(168),
      active_days       = v_days,
      active_hour_start = (p_schedule->>'active_hour_start')::smallint,
      active_hour_end   = (p_schedule->>'active_hour_end')::smallint,
      updated_at        = now()
    where id = p_placement_id;
  end if;

  with req as (
    select p_cells[i] as z, p_cells[i+1] as x, p_cells[i+2] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 2, 3) as i
  ),
  conflicts as (
    select distinct req.z, req.x, req.y
    from req
    join public.reward_placement_cells rc on rc.placement_id <> p_placement_id
      and public.tiles_overlap(req.z, req.x, req.y, rc.z, rc.x, rc.y)
    join public.reward_placements p2 on p2.id = rc.placement_id and p2.active = true
    where tstzrange(coalesce(v_starts, '-infinity'), coalesce(v_ends, 'infinity'), '[]')
          && tstzrange(coalesce(p2.starts_at, '-infinity'), coalesce(p2.ends_at, 'infinity'), '[]')
      and (v_mask & coalesce(p2.week_mask, (repeat('1',168))::bit(168))) <> (repeat('0',168))::bit(168)
  )
  select string_agg(z || '/' || x || ',' || y, ' '), count(*) into v_conflicts, v_count from conflicts;

  if coalesce(v_count, 0) > 0 then
    raise exception 'CELL_CONFLICT: %', v_conflicts;
  end if;

  delete from public.reward_placement_cells where placement_id = p_placement_id;

  with req as (
    select p_cells[i] as z, p_cells[i+1] as x, p_cells[i+2] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 2, 3) as i
  )
  insert into public.reward_placement_cells (placement_id, z, x, y)
  select p_placement_id, z, x, y from req;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_placement_cells(uuid, integer[], jsonb) from public, anon;
grant execute on function public.set_placement_cells(uuid, integer[], jsonb) to authenticated;
