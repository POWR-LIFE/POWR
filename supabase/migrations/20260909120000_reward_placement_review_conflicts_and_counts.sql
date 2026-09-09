-- =============================================================
-- REWARD PLACEMENTS -> approval re-checks conflicts, pending squares
-- visible on the map, and cell counts without a row-cap footgun
-- =============================================================
-- 1. A draft / pending campaign never reserves its squares (only active
--    placements count in the conflict scan and the occupancy map), and
--    review_reward_placement flipped `active` on WITHOUT re-running the scan.
--    Two brands could each submit the same square for the same times and
--    both be approved — a live double-booking the editor promised could not
--    happen. Approval now runs the same conflict scan set_placement_cells
--    uses, under the same advisory lock, and raises CELL_CONFLICT instead
--    of activating. The scan itself moves into one helper so the two paths
--    cannot drift.
-- 2. get_taken_grid_cells now also returns squares held by campaigns that are
--    awaiting review, flagged `pending`, so the editors can paint them amber
--    ("first approved wins") instead of pretending the ground is free.
--    Return type changes -> drop + recreate. Auth gate unchanged from the
--    2026-07-27 hardening pass (admin, or flag on AND brand member).
-- 3. Both portals counted squares by fetching every reward_placement_cells
--    row and tallying client-side; PostgREST caps that at 1000 rows and one
--    large placement can exceed it alone. get_placement_cell_counts returns
--    the counts server-side, gated like get_placement_stats.
-- =============================================================

-- ── 1a. Shared conflict scan ──────────────────────────────────────────────────
-- Cells to test come from p_cells (flat [z,x,y] triples) when given, else the
-- placement's stored cells. Schedule is always the placement's stored one —
-- set_placement_cells applies p_schedule to the row BEFORE calling this, so
-- the scan sees the schedule that will actually be live.
--
-- SECURITY INVOKER on purpose: it is only ever called from inside definer
-- functions (where it runs as their owner and sees every brand's cells), and
-- EXECUTE is revoked from every client role so it cannot be used as an
-- occupancy oracle directly.
create or replace function public.placement_cell_conflicts(
  p_placement_id uuid,
  p_cells integer[] default null
)
returns table (z smallint, x integer, y integer)
language sql
stable
set search_path = ''
as $$
  with me as (
    select
      tstzrange(coalesce(pl.starts_at, '-infinity'), coalesce(pl.ends_at, 'infinity'), '[]') as flight,
      coalesce(pl.week_mask, (repeat('1', 168))::bit(168)) as mask
    from public.reward_placements pl
    where pl.id = p_placement_id
  ),
  requested_cells as (
    select p_cells[i]::smallint as z, p_cells[i + 1] as x, p_cells[i + 2] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 2, 3) as i
    where p_cells is not null
    union all
    select rc.z, rc.x, rc.y
    from public.reward_placement_cells rc
    where p_cells is null and rc.placement_id = p_placement_id
  )
  -- Union widens z to integer; the declared return type is smallint.
  select distinct requested_cells.z::smallint, requested_cells.x, requested_cells.y
  from requested_cells
  cross join me
  join public.reward_placement_cells existing_cells
    on existing_cells.placement_id <> p_placement_id
    and public.tiles_overlap(
      requested_cells.z, requested_cells.x, requested_cells.y,
      existing_cells.z, existing_cells.x, existing_cells.y
    )
  join public.reward_placements other_placement
    on other_placement.id = existing_cells.placement_id
    and other_placement.active = true
  where me.flight
        && tstzrange(coalesce(other_placement.starts_at, '-infinity'), coalesce(other_placement.ends_at, 'infinity'), '[]')
    and (me.mask & coalesce(other_placement.week_mask, (repeat('1', 168))::bit(168)))
        <> (repeat('0', 168))::bit(168);
$$;

revoke all on function public.placement_cell_conflicts(uuid, integer[]) from public, anon, authenticated;

-- ── 1b. set_placement_cells uses the shared scan ─────────────────────────────
-- Behaviour identical to 20260712091503; only the conflict CTE is replaced.
create or replace function public.set_placement_cells(
  p_placement_id uuid,
  p_cells integer[],
  p_schedule jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward uuid;
  v_status text;
  v_days smallint[];
  v_conflicts text;
  v_count integer;
begin
  select reward_id, status
    into v_reward, v_status
  from public.reward_placements
  where id = p_placement_id;
  if not found then raise exception 'PLACEMENT_NOT_FOUND'; end if;

  if not (
    exists (select 1 from public.admin_roles where user_id = auth.uid())
    or (v_status in ('draft', 'rejected') and public.can_manage_own_reward_placements(v_reward))
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  perform pg_advisory_xact_lock(hashtext('reward_placement_cells'));

  if p_schedule is not null then
    if jsonb_typeof(p_schedule->'active_days') = 'array' then
      select array_agg(day_value.value::smallint) into v_days
      from jsonb_array_elements_text(p_schedule->'active_days') as day_value(value);
    else
      v_days := null;
    end if;

    update public.reward_placements set
      starts_at = (p_schedule->>'starts_at')::timestamptz,
      ends_at = (p_schedule->>'ends_at')::timestamptz,
      week_mask = nullif(p_schedule->>'week_mask', '')::bit(168),
      active_days = v_days,
      active_hour_start = (p_schedule->>'active_hour_start')::smallint,
      active_hour_end = (p_schedule->>'active_hour_end')::smallint,
      updated_at = now()
    where id = p_placement_id;
  end if;

  select string_agg(c.z || '/' || c.x || ',' || c.y, ' '), count(*)
    into v_conflicts, v_count
  from public.placement_cell_conflicts(p_placement_id, p_cells) c;

  if coalesce(v_count, 0) > 0 then
    raise exception 'CELL_CONFLICT: %', v_conflicts;
  end if;

  delete from public.reward_placement_cells where placement_id = p_placement_id;

  with requested_cells as (
    select p_cells[i] as z, p_cells[i + 1] as x, p_cells[i + 2] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 2, 3) as i
  )
  insert into public.reward_placement_cells (placement_id, z, x, y)
  select p_placement_id, z, x, y from requested_cells;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_placement_cells(uuid, integer[], jsonb) from public, anon;
grant execute on function public.set_placement_cells(uuid, integer[], jsonb) to authenticated;

-- ── 1c. Approval re-checks conflicts before activating ───────────────────────
-- Same lock as set_placement_cells so an approve and a competing save cannot
-- interleave between scan and write. A conflict leaves the campaign in
-- pending_review untouched; the admin sees which squares and can ask the
-- brand to revise, or reject with a note.
create or replace function public.review_reward_placement(
  p_placement_id uuid,
  p_decision text,
  p_note text default null
)
returns public.reward_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_placement public.reward_placements;
  v_conflicts text;
  v_count integer;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;

  -- Lock order matches set_placement_cells (advisory first, then the row) so
  -- an approve racing a save can never deadlock.
  if p_decision = 'approve' then
    perform pg_advisory_xact_lock(hashtext('reward_placement_cells'));
  end if;

  select * into v_placement
  from public.reward_placements
  where id = p_placement_id
  for update;

  if not found then raise exception 'PLACEMENT_NOT_FOUND'; end if;
  if v_placement.status <> 'pending_review' then
    raise exception 'PLACEMENT_NOT_PENDING_REVIEW';
  end if;

  if p_decision = 'approve' then
    if not exists (
      select 1 from public.reward_placement_cells where placement_id = p_placement_id
    ) then
      raise exception 'PLACEMENT_CELLS_REQUIRED';
    end if;

    select string_agg(c.z || '/' || c.x || ',' || c.y, ' '), count(*)
      into v_conflicts, v_count
    from public.placement_cell_conflicts(p_placement_id) c;

    if coalesce(v_count, 0) > 0 then
      raise exception 'CELL_CONFLICT: %', v_conflicts;
    end if;
  end if;

  update public.reward_placements
  set status = case when p_decision = 'approve' then 'live' else 'rejected' end,
      active = p_decision = 'approve',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = nullif(btrim(p_note), ''),
      updated_at = now()
  where id = p_placement_id
  returning * into v_placement;

  return v_placement;
end;
$$;

revoke all on function public.review_reward_placement(uuid, text, text) from public, anon;
grant execute on function public.review_reward_placement(uuid, text, text) to authenticated;

-- ── 2. Occupancy map: live squares AND squares awaiting review ───────────────
drop function if exists public.get_taken_grid_cells(
  double precision, double precision, double precision, double precision,
  uuid, timestamp with time zone, timestamp with time zone, text
);

create function public.get_taken_grid_cells(
  p_south double precision,
  p_west double precision,
  p_north double precision,
  p_east double precision,
  p_exclude uuid,
  p_starts timestamp with time zone,
  p_ends timestamp with time zone,
  p_mask text
)
returns table (z smallint, x integer, y integer, pending boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with occupied_cells as (
    select rc.z, rc.x, rc.y, rc.placement_id,
      (rc.x::float / (1 << rc.z::int) * 360 - 180) as west,
      ((rc.x + 1)::float / (1 << rc.z::int) * 360 - 180) as east,
      degrees(atan(sinh(pi() * (1 - 2 * rc.y::float / (1 << rc.z::int))))) as north,
      degrees(atan(sinh(pi() * (1 - 2 * (rc.y + 1)::float / (1 << rc.z::int))))) as south
    from public.reward_placement_cells rc
  )
  select occupied_cells.z, occupied_cells.x, occupied_cells.y,
         (other_placement.active = false) as pending
  from occupied_cells
  join public.reward_placements other_placement on other_placement.id = occupied_cells.placement_id
  where (
      exists (select 1 from public.admin_roles where user_id = auth.uid())
      or (
        public.partner_placements_enabled()
        and exists (select 1 from public.reward_brand_users where user_id = auth.uid())
      )
    )
    and (other_placement.active = true or other_placement.status = 'pending_review')
    and occupied_cells.placement_id is distinct from p_exclude
    and occupied_cells.west <= p_east and occupied_cells.east >= p_west
    and occupied_cells.south <= p_north and occupied_cells.north >= p_south
    and tstzrange(coalesce(p_starts, '-infinity'), coalesce(p_ends, 'infinity'), '[]')
        && tstzrange(coalesce(other_placement.starts_at, '-infinity'), coalesce(other_placement.ends_at, 'infinity'), '[]')
    and (
      coalesce(nullif(p_mask, '')::bit(168), (repeat('1', 168))::bit(168))
      & coalesce(other_placement.week_mask, (repeat('1', 168))::bit(168))
    ) <> (repeat('0', 168))::bit(168);
$$;

revoke all on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamp with time zone, timestamp with time zone, text) from public, anon;
grant execute on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamp with time zone, timestamp with time zone, text) to authenticated;

-- ── 3. Server-side square counts ─────────────────────────────────────────────
create or replace function public.get_placement_cell_counts(p_placement_ids uuid[])
returns table (placement_id uuid, cells bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select rc.placement_id, count(*)
  from public.reward_placement_cells rc
  join public.reward_placements pl on pl.id = rc.placement_id
  where rc.placement_id = any (p_placement_ids)
    and (
      exists (select 1 from public.admin_roles where user_id = auth.uid())
      or public.user_owns_reward_brand(pl.reward_id)
    )
  group by rc.placement_id;
$$;

revoke all on function public.get_placement_cell_counts(uuid[]) from public, anon;
grant execute on function public.get_placement_cell_counts(uuid[]) to authenticated;
