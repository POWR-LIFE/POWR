-- =============================================================
-- REWARD PLACEMENT GRID → adaptive (multi-zoom) cells
-- =============================================================
-- Cells are painted at whatever zoom the admin is viewing, so a city-wide
-- campaign is a handful of big tiles and a venue is a few 190m tiles.
-- Each cell keeps its own zoom (z). Two tiles overlap on the ground iff
-- one contains the other (a coarse tile contains the finer tiles beneath
-- it) — computed with an integer bit-shift.
-- =============================================================

create or replace function public.tiles_overlap(
  z1 integer, x1 integer, y1 integer,
  z2 integer, x2 integer, y2 integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when z1 <= z2 then (x2 >> (z2 - z1)) = x1 and (y2 >> (z2 - z1)) = y1
    else (x1 >> (z1 - z2)) = x2 and (y1 >> (z1 - z2)) = y2
  end;
$$;

-- ── Resolver: match the user's tile at EACH cell's own zoom ───────────────────
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
            select 1 from public.reward_placement_cells rc
            where rc.placement_id = pl.id
              and rc.x = floor((p_lng + 180.0) / 360.0 * (1 << rc.z::int))::int
              and rc.y = floor((1 - asinh(tan(radians(p_lat))) / pi()) / 2 * (1 << rc.z::int))::int
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

-- ── Admin occupancy: cells intersecting a lat/lng viewport ────────────────────
drop function if exists public.get_taken_grid_cells(integer, integer, integer, integer, uuid, timestamptz, timestamptz, text);

create function public.get_taken_grid_cells(
  p_south   double precision,
  p_west    double precision,
  p_north   double precision,
  p_east    double precision,
  p_exclude uuid,
  p_starts  timestamptz,
  p_ends    timestamptz,
  p_mask    text
)
returns table (z smallint, x integer, y integer)
language sql
stable
security definer
set search_path = ''
as $$
  with occ as (
    select rc.z, rc.x, rc.y, rc.placement_id,
      (rc.x::float / (1 << rc.z::int) * 360 - 180)                                          as cw,
      ((rc.x + 1)::float / (1 << rc.z::int) * 360 - 180)                                    as ce,
      degrees(atan(sinh(pi() * (1 - 2 * rc.y::float / (1 << rc.z::int)))))                  as cn,
      degrees(atan(sinh(pi() * (1 - 2 * (rc.y + 1)::float / (1 << rc.z::int)))))            as cs
    from public.reward_placement_cells rc
  )
  select o.z, o.x, o.y
  from occ o
  join public.reward_placements p2 on p2.id = o.placement_id
  where exists (select 1 from public.admin_roles where user_id = auth.uid())
    and p2.active = true
    and o.placement_id is distinct from p_exclude
    and o.cw <= p_east and o.ce >= p_west and o.cs <= p_north and o.cn >= p_south
    and tstzrange(coalesce(p_starts, '-infinity'), coalesce(p_ends, 'infinity'), '[]')
        && tstzrange(coalesce(p2.starts_at, '-infinity'), coalesce(p2.ends_at, 'infinity'), '[]')
    and (
      coalesce(nullif(p_mask, '')::bit(168), (repeat('1', 168))::bit(168))
      & coalesce(p2.week_mask, (repeat('1', 168))::bit(168))
    ) <> (repeat('0', 168))::bit(168);
$$;

-- ── Set cells (now [z,x,y] triples) with cross-zoom conflict check ────────────
create or replace function public.set_placement_cells(
  p_placement_id uuid,
  p_cells        integer[]   -- flat [z1,x1,y1, z2,x2,y2, ...]
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

revoke all on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.tiles_overlap(integer, integer, integer, integer, integer, integer) to authenticated, anon;
