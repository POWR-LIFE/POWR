-- =============================================================
-- REWARD PLACEMENTS → GRID CELLS (time-sliced, non-overlapping)
-- =============================================================
-- Replaces the circle fence with a selection of Web-Mercator map tiles
-- at a fixed zoom (17 ≈ 190 m squares). A placement owns a SET of cells.
--
-- "No overlap" is time-sliced: two placements may share a cell only if
-- their date ranges AND their weekly schedules do not intersect. The
-- weekly schedule is a 168-bit mask (7 days x 24 hours); overlap is a
-- single `maskA & maskB <> 0` test — no hour-wraparound SQL needed.
-- =============================================================

-- Weekly recurrence mask (bit i = day*24 + hour, day 0=Sun..6=Sat).
-- NULL = always active (no recurring restriction).
alter table public.reward_placements
  add column if not exists week_mask bit(168);

-- Allow geo_mode = 'grid' (cells live in the child table; the row needs
-- no center/radius). Rebuild both geo constraints to include it.
alter table public.reward_placements drop constraint if exists reward_placements_geo_mode_check;
alter table public.reward_placements drop constraint if exists reward_placements_geo_check;

alter table public.reward_placements
  add constraint reward_placements_geo_mode_check
  check (geo_mode in ('fence', 'partner_venue', 'poi_category', 'grid'));

alter table public.reward_placements
  add constraint reward_placements_geo_check check (
    (geo_mode = 'fence'         and center_lat is not null and center_lng is not null and radius_m is not null)
    or (geo_mode = 'partner_venue' and target_partner_id is not null)
    or (geo_mode = 'poi_category'  and poi_category is not null)
    or (geo_mode = 'grid')
  );

-- One row per (placement, tile). z is fixed at 17 but stored for clarity.
create table if not exists public.reward_placement_cells (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.reward_placements(id) on delete cascade,
  z            smallint not null default 17,
  x            integer not null,
  y            integer not null,
  created_at   timestamptz not null default now()
);

create index if not exists reward_placement_cells_xy_idx
  on public.reward_placement_cells (z, x, y);
create index if not exists reward_placement_cells_placement_idx
  on public.reward_placement_cells (placement_id);

alter table public.reward_placement_cells enable row level security;

create policy "Admins manage placement cells"
  on public.reward_placement_cells for all
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- RESOLVER — grid-aware (still lat/lng in; computes the user's tile)
-- =============================================================
create or replace function public.resolve_reward_placements(
  p_lat        double precision,
  p_lng        double precision,
  p_local_dow  smallint default null,
  p_local_hour smallint default null
)
returns table (
  placement_id uuid,
  reward_id    uuid,
  visibility   text,
  priority     integer,
  paid         boolean,
  partner_id   uuid,
  distance_m   double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.activity_preferences
    from public.profiles p
    where p.id = auth.uid()
  ),
  utile as (
    -- Slippy-tile (x,y) for the user at zoom 17 (2^17 = 131072).
    select
      floor((p_lng + 180.0) / 360.0 * 131072)::int as ux,
      floor((1 - asinh(tan(radians(p_lat))) / pi()) / 2 * 131072)::int as uy
  ),
  candidates as (
    select
      pl.id, pl.reward_id, pl.visibility, pl.priority, pl.paid, pl.partner_id,
      pl.target_activities, pl.max_impressions_per_user_per_day,
      case
        when pl.geo_mode = 'partner_venue' then coalesce(pl.radius_m, 150)
        when pl.geo_mode = 'fence' then pl.radius_m
        else null
      end as eff_radius_m,
      case
        when pl.geo_mode = 'grid' then (
          select case when exists (
            select 1 from public.reward_placement_cells rc, utile
            where rc.placement_id = pl.id and rc.z = 17
              and rc.x = utile.ux and rc.y = utile.uy
          ) then 0.0 else null end
        )
        when pl.geo_mode = 'fence' then
          111320.0 * sqrt(
            power(pl.center_lat - p_lat, 2) +
            power((pl.center_lng - p_lng) * cos(radians(p_lat)), 2)
          )
        when pl.geo_mode = 'partner_venue' then (
          select min(
            111320.0 * sqrt(
              power((loc->>'lat')::float8 - p_lat, 2) +
              power(((loc->>'lng')::float8 - p_lng) * cos(radians(p_lat)), 2)
            )
          )
          from public.partners tp, jsonb_array_elements(tp.locations) as loc
          where tp.id = pl.target_partner_id
            and loc->>'lat' is not null and loc->>'lng' is not null
        )
        else null
      end as dist_m
    from public.reward_placements pl
    where pl.active = true
      and (pl.starts_at is null or pl.starts_at <= now())
      and (pl.ends_at   is null or pl.ends_at   >= now())
      and (pl.active_days is null or p_local_dow is null or p_local_dow = any (pl.active_days))
      and (
        pl.active_hour_start is null or pl.active_hour_end is null or p_local_hour is null
        or (
          case
            when pl.active_hour_start <= pl.active_hour_end
              then p_local_hour between pl.active_hour_start and pl.active_hour_end
            else p_local_hour >= pl.active_hour_start or p_local_hour <= pl.active_hour_end
          end
        )
      )
  )
  select
    c.id, c.reward_id, c.visibility, c.priority, c.paid, c.partner_id, c.dist_m
  from candidates c
  join public.rewards r on r.id = c.reward_id and r.active = true
  left join me on true
  where c.dist_m is not null
    and (c.eff_radius_m is null or c.dist_m <= c.eff_radius_m)
    and (
      c.target_activities is null
      or (me.activity_preferences is not null and c.target_activities && me.activity_preferences::text[])
    )
    and (
      c.max_impressions_per_user_per_day is null
      or (
        select count(*)
        from public.reward_placement_events e
        where e.placement_id = c.id
          and e.user_id = auth.uid()
          and e.event_type = 'surfaced'
          and e.created_at > now() - interval '1 day'
      ) < c.max_impressions_per_user_per_day
    )
  order by c.paid desc, c.priority desc, c.dist_m asc;
$$;

-- =============================================================
-- ADMIN: occupied cells in a viewport (for red/green shading)
-- =============================================================
-- Returns cells in the bbox already taken by OTHER active placements
-- whose date range AND weekly mask intersect the schedule being edited.
create or replace function public.get_taken_grid_cells(
  p_x_min   integer,
  p_x_max   integer,
  p_y_min   integer,
  p_y_max   integer,
  p_exclude uuid,
  p_starts  timestamptz,
  p_ends    timestamptz,
  p_mask    text          -- 168-char '0'/'1'; '' or null = always-on
)
returns table (x integer, y integer)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rc.x, rc.y
  from public.reward_placement_cells rc
  join public.reward_placements p2 on p2.id = rc.placement_id
  where exists (select 1 from public.admin_roles where user_id = auth.uid())
    and rc.z = 17
    and p2.active = true
    and rc.placement_id is distinct from p_exclude
    and rc.x between p_x_min and p_x_max
    and rc.y between p_y_min and p_y_max
    and tstzrange(coalesce(p_starts, '-infinity'), coalesce(p_ends, 'infinity'), '[]')
        && tstzrange(coalesce(p2.starts_at, '-infinity'), coalesce(p2.ends_at, 'infinity'), '[]')
    and (
      coalesce(nullif(p_mask, '')::bit(168), (repeat('1', 168))::bit(168))
      & coalesce(p2.week_mask, (repeat('1', 168))::bit(168))
    ) <> (repeat('0', 168))::bit(168);
$$;

-- =============================================================
-- ADMIN: atomically set a placement's cells with a conflict check
-- =============================================================
-- p_cells is a flat array [x1,y1,x2,y2,...] at zoom 17. Raises
-- CELL_CONFLICT if any requested cell is already taken by another
-- active placement for an overlapping time slice.
create or replace function public.set_placement_cells(
  p_placement_id uuid,
  p_cells        integer[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts timestamptz;
  v_ends   timestamptz;
  v_mask   bit(168);
  v_conflicts text;
  v_count  integer;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'NOT_ADMIN';
  end if;

  select starts_at, ends_at, coalesce(week_mask, (repeat('1',168))::bit(168))
    into v_starts, v_ends, v_mask
  from public.reward_placements where id = p_placement_id;
  if not found then raise exception 'PLACEMENT_NOT_FOUND'; end if;

  -- Requested cells as (x,y) rows.
  with req as (
    select p_cells[i] as x, p_cells[i+1] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 1, 2) as i
  ),
  conflicts as (
    select distinct rc.x, rc.y
    from public.reward_placement_cells rc
    join public.reward_placements p2 on p2.id = rc.placement_id
    join req on req.x = rc.x and req.y = rc.y
    where rc.z = 17
      and rc.placement_id <> p_placement_id
      and p2.active = true
      and tstzrange(coalesce(v_starts, '-infinity'), coalesce(v_ends, 'infinity'), '[]')
          && tstzrange(coalesce(p2.starts_at, '-infinity'), coalesce(p2.ends_at, 'infinity'), '[]')
      and (v_mask & coalesce(p2.week_mask, (repeat('1',168))::bit(168))) <> (repeat('0',168))::bit(168)
  )
  select string_agg(x || ',' || y, ' '), count(*) into v_conflicts, v_count from conflicts;

  if coalesce(v_count, 0) > 0 then
    raise exception 'CELL_CONFLICT: %', v_conflicts;
  end if;

  delete from public.reward_placement_cells where placement_id = p_placement_id;

  with req as (
    select p_cells[i] as x, p_cells[i+1] as y
    from generate_series(1, coalesce(array_length(p_cells, 1), 0) - 1, 2) as i
  )
  insert into public.reward_placement_cells (placement_id, z, x, y)
  select p_placement_id, 17, x, y from req;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.get_taken_grid_cells(integer, integer, integer, integer, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.set_placement_cells(uuid, integer[]) from public, anon;
grant execute on function public.get_taken_grid_cells(integer, integer, integer, integer, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.set_placement_cells(uuid, integer[]) to authenticated;
