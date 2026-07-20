-- =============================================================
-- REWARD PLACEMENTS -> partner campaign lifecycle + real entitlement gate
-- =============================================================
-- A self-serve placement must never become live merely because a browser
-- posted a form. Partners create and edit inactive drafts, then submit them
-- for review. Admins retain their existing unrestricted management policy.
--
-- The existing `active` flag remains the resolver's live switch so this is
-- backwards compatible with already-running placements. New status values
-- make lifecycle visible to the portals without changing resolver behaviour.
-- =============================================================

alter table public.reward_placements
  add column if not exists campaign_name text,
  add column if not exists status text not null default 'live'
    check (status in ('draft', 'pending_review', 'scheduled', 'live', 'paused', 'ended', 'rejected')),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists review_note text;

alter table public.reward_placements
  drop constraint if exists reward_placements_review_state_inactive,
  add constraint reward_placements_review_state_inactive check (
    status not in ('draft', 'pending_review', 'rejected', 'paused', 'ended')
    or active = false
  );

-- Existing rows predate lifecycle states. Preserve their real resolver state.
update public.reward_placements
set status = case when active then 'live' else 'paused' end
where status = 'live' and created_at < '2026-07-12T00:00:00Z';

-- The mobile vault currently treats `exclusive` exactly like `boost`; do not
-- leave an admin control that appears to promise a different member outcome.
update public.reward_placements
set visibility = 'boost'
where visibility = 'exclusive';

create index if not exists reward_placements_status_idx
  on public.reward_placements (status, created_at desc);

-- This is deliberately a SECURITY DEFINER helper: authenticated brand users
-- can read only the one public feature flag, while authorization checks use
-- the same source of truth even if a caller bypasses the portal UI.
create or replace function public.partner_placements_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select value = 'true'
    from public.system_config
    where key = 'partner_placements_enabled'
  ), false);
$$;

revoke all on function public.partner_placements_enabled() from public, anon;
grant execute on function public.partner_placements_enabled() to authenticated;

create or replace function public.can_manage_own_reward_placements(p_reward_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.partner_placements_enabled()
    and public.user_owns_reward_brand(p_reward_id);
$$;

revoke all on function public.can_manage_own_reward_placements(uuid) from public, anon;
grant execute on function public.can_manage_own_reward_placements(uuid) to authenticated;

-- Replace the original permissive brand policies. Admin policies remain
-- additive, so this does not narrow the internal operations workflow.
drop policy if exists "Brands read own reward placements" on public.reward_placements;
drop policy if exists "Brands insert own reward placements" on public.reward_placements;
drop policy if exists "Brands update own reward placements" on public.reward_placements;
drop policy if exists "Brands delete own reward placements" on public.reward_placements;

create policy "Brands read own reward placements"
  on public.reward_placements for select
  to authenticated
  using (public.can_manage_own_reward_placements(reward_id));

create policy "Brands insert own placement drafts"
  on public.reward_placements for insert
  to authenticated
  with check (
    public.can_manage_own_reward_placements(reward_id)
    and geo_mode = 'grid'
    and visibility = 'boost'
    and priority = 0
    and paid = true
    and partner_id is null
    and billing_status = 'beta'
    and status = 'draft'
    and active = false
  );

-- A submitted campaign is immutable to the partner: they withdraw it by
-- asking the admin team, or duplicate it into a new draft after feedback.
create policy "Brands update own placement drafts"
  on public.reward_placements for update
  to authenticated
  using (
    status in ('draft', 'rejected')
    and public.can_manage_own_reward_placements(reward_id)
  )
  with check (
    public.can_manage_own_reward_placements(reward_id)
    and geo_mode = 'grid'
    and visibility = 'boost'
    and priority = 0
    and paid = true
    and partner_id is null
    and billing_status = 'beta'
    and status = 'draft'
    and active = false
  );

create policy "Brands delete own placement drafts"
  on public.reward_placements for delete
  to authenticated
  using (
    status in ('draft', 'rejected')
    and public.can_manage_own_reward_placements(reward_id)
  );

-- The prior self-serve policy allowed direct writes to the child table,
-- bypassing conflict checks and the draft-only lifecycle. Brands only need
-- read access here; all writes go through set_placement_cells below.
drop policy if exists "Brands manage own placement cells" on public.reward_placement_cells;

create policy "Brands read own placement cells"
  on public.reward_placement_cells for select
  to authenticated
  using (exists (
    select 1
    from public.reward_placements placement
    where placement.id = reward_placement_cells.placement_id
      and public.can_manage_own_reward_placements(placement.reward_id)
  ));

-- The cells RPC is a definer function and must repeat the lifecycle check;
-- table RLS does not protect code executing inside the function.
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
  v_starts timestamptz;
  v_ends timestamptz;
  v_mask bit(168);
  v_days smallint[];
  v_conflicts text;
  v_count integer;
begin
  select reward_id, status, starts_at, ends_at,
      coalesce(week_mask, (repeat('1', 168))::bit(168))
    into v_reward, v_status, v_starts, v_ends, v_mask
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
    v_starts := (p_schedule->>'starts_at')::timestamptz;
    v_ends := (p_schedule->>'ends_at')::timestamptz;
    v_mask := coalesce(nullif(p_schedule->>'week_mask', ''), repeat('1', 168))::bit(168);
    if jsonb_typeof(p_schedule->'active_days') = 'array' then
      select array_agg(day_value.value::smallint) into v_days
      from jsonb_array_elements_text(p_schedule->'active_days') as day_value(value);
    else
      v_days := null;
    end if;

    update public.reward_placements set
      starts_at = v_starts,
      ends_at = v_ends,
      week_mask = nullif(p_schedule->>'week_mask', '')::bit(168),
      active_days = v_days,
      active_hour_start = (p_schedule->>'active_hour_start')::smallint,
      active_hour_end = (p_schedule->>'active_hour_end')::smallint,
      updated_at = now()
    where id = p_placement_id;
  end if;

  with requested_cells as (
    select p_cells[i] as z, p_cells[i + 1] as x, p_cells[i + 2] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 2, 3) as i
  ), conflicts as (
    select distinct requested_cells.z, requested_cells.x, requested_cells.y
    from requested_cells
    join public.reward_placement_cells existing_cells
      on existing_cells.placement_id <> p_placement_id
      and public.tiles_overlap(
        requested_cells.z, requested_cells.x, requested_cells.y,
        existing_cells.z, existing_cells.x, existing_cells.y
      )
    join public.reward_placements other_placement
      on other_placement.id = existing_cells.placement_id
      and other_placement.active = true
    where tstzrange(coalesce(v_starts, '-infinity'), coalesce(v_ends, 'infinity'), '[]')
          && tstzrange(coalesce(other_placement.starts_at, '-infinity'), coalesce(other_placement.ends_at, 'infinity'), '[]')
      and (v_mask & coalesce(other_placement.week_mask, (repeat('1', 168))::bit(168)))
          <> (repeat('0', 168))::bit(168)
  )
  select string_agg(z || '/' || x || ',' || y, ' '), count(*) into v_conflicts, v_count
  from conflicts;

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

-- A partner cannot manufacture a live placement. Submission validates the
-- minimum campaign shape and is the only state transition available to them.
create or replace function public.submit_reward_placement(p_placement_id uuid)
returns public.reward_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_placement public.reward_placements;
begin
  select * into v_placement
  from public.reward_placements
  where id = p_placement_id
  for update;

  if not found then raise exception 'PLACEMENT_NOT_FOUND'; end if;
  if not public.can_manage_own_reward_placements(v_placement.reward_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_placement.status <> 'draft' then
    raise exception 'PLACEMENT_NOT_DRAFT';
  end if;
  if v_placement.campaign_name is null or btrim(v_placement.campaign_name) = '' then
    raise exception 'CAMPAIGN_NAME_REQUIRED';
  end if;
  if not exists (
    select 1 from public.reward_placement_cells where placement_id = p_placement_id
  ) then
    raise exception 'PLACEMENT_CELLS_REQUIRED';
  end if;
  if v_placement.starts_at is not null and v_placement.ends_at is not null
      and v_placement.ends_at < v_placement.starts_at then
    raise exception 'INVALID_FLIGHT_WINDOW';
  end if;

  update public.reward_placements
  set status = 'pending_review',
      active = false,
      submitted_at = now(),
      review_note = null,
      updated_at = now()
  where id = p_placement_id
  returning * into v_placement;

  return v_placement;
end;
$$;

revoke all on function public.submit_reward_placement(uuid) from public, anon;
grant execute on function public.submit_reward_placement(uuid) to authenticated;

-- Admin review owns the only transition from a submitted campaign into a
-- resolver-visible placement. Keeping this server-side avoids a UI sequence
-- that could leave a campaign marked approved but inactive (or vice versa).
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
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;

  select * into v_placement
  from public.reward_placements
  where id = p_placement_id
  for update;

  if not found then raise exception 'PLACEMENT_NOT_FOUND'; end if;
  if v_placement.status <> 'pending_review' then
    raise exception 'PLACEMENT_NOT_PENDING_REVIEW';
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

-- Occupancy is available only while the self-serve programme is actually on.
create or replace function public.get_taken_grid_cells(
  p_south double precision,
  p_west double precision,
  p_north double precision,
  p_east double precision,
  p_exclude uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_mask text
)
returns table (z smallint, x integer, y integer)
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
  select occupied_cells.z, occupied_cells.x, occupied_cells.y
  from occupied_cells
  join public.reward_placements other_placement on other_placement.id = occupied_cells.placement_id
  where (
      exists (select 1 from public.admin_roles where user_id = auth.uid())
      or public.partner_placements_enabled()
    )
    and other_placement.active = true
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

revoke all on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamptz, timestamptz, text) to authenticated;