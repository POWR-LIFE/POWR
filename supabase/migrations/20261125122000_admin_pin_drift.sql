-- ============================================================================
-- admin_pin_drift — where members actually stand, against where the pin is
-- (geofence review 2026-11-25, step 2)
-- ============================================================================
--
-- WHY. 8,001 of 8,007 venues are a 25 m circle round one pin, so a visit is
-- only ever as right as the pin. Until now a wrong pin was invisible: phones
-- reported a DISTANCE, and a distance cannot say which way the pin is off.
-- 30 days to 2026-11-25: 38 gym workouts recorded on a watch happened with the
-- phone within 150 m of a pin and earned no visit — 18 at one venue, where the
-- phone sat a median 90 m from the pin.
--
-- WHAT FEEDS IT. From the app update that ships with this, every at-venue
-- reading carries its offset from the pin in whole metres east/north (dx_m,
-- dy_m — lib/geofence/zone.ts pinOffsetM). Never a latitude or longitude, and
-- only within 150 m of a pin. Two sources, both existing jsonb columns, so this
-- file adds no table:
--
--   • gym_visit_events `confirmed_inside` — readings from members who are
--     checked in. These place the venue's real centre.
--   • geofence_region_events `enter_scan` / no_match_in_ring — readings from
--     phones inside the wake ring that did NOT check in. Reported separately and
--     never blended into the centre: they include neighbours and passers-by
--     (30 days to 11-25: 102 member-venue-days of "lingering just outside",
--     mostly people at home or work).
--
-- HOW IT COUNTS. Sharp, fresh, trusted readings only (accuracy <= 20 m, age
-- <= 120 s). One vote per member per day — the median of that day's readings —
-- so a member who trains daily, or a phone that answers every wake, cannot
-- outvote everyone else. The venue's centre is the median of those votes.
--
-- WHAT IT RETURNS. One row per venue location with enough votes from either
-- source: the offset of the members' centre from the pin, how many votes fall
-- outside the circle, and the latitude/longitude the pin would have if moved
-- onto that centre. A venue nobody manages to check into appears on its near
-- misses alone, marked as such and with no suggested pin. It changes nothing.
-- Moving a pin stays a person's decision.
--
-- Read-only, admins only. Useful a few weeks after the app update reaches the
-- fleet; before then it returns no rows.
-- ============================================================================

create or replace function public.admin_pin_drift(
  p_days      int default 60,
  p_min_votes int default 5
)
returns table (
  partner_id           uuid,
  location_idx         int,
  partner_name         text,
  radius_m             numeric,
  pin_lat              double precision,
  pin_lng              double precision,
  votes                int,      -- member-days of in-visit readings
  members              int,
  readings             int,
  centre_dx_m          numeric,  -- members' centre, metres EAST of the pin
  centre_dy_m          numeric,  -- members' centre, metres NORTH of the pin
  offset_m             numeric,  -- how far that centre is from the pin
  median_distance_m    numeric,
  p90_distance_m       numeric,
  share_outside_circle numeric,  -- votes further from the pin than the radius
  near_miss_votes      int,      -- member-days inside the wake ring with no check-in
  near_miss_members    int,
  near_miss_median_m   numeric,
  near_miss_dx_m       numeric,  -- where those phones sat, metres EAST of the pin
  near_miss_dy_m       numeric,  -- …and NORTH. A hint, not a centre: see above.
  suggested_lat        double precision,
  suggested_lng        double precision,
  confidence           text      -- 'strong' | 'fair' | 'weak' | 'near misses only'
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365)));
  v_min   int := greatest(1, coalesce(p_min_votes, 5));
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;

  return query
  with locs as (
    select p.id                                          as partner_id,
           (l.ord - 1)::int                              as idx,
           p.name                                        as partner_name,
           coalesce(_gym_detail_num(l.loc, 'radius'), 100) as radius_m,
           (l.loc ->> 'lat')::double precision           as lat,
           (l.loc ->> 'lng')::double precision           as lng
      from partners p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.locations::jsonb) = 'array' then p.locations::jsonb
             else jsonb_build_array(p.locations::jsonb) end
      ) with ordinality as l(loc, ord)
     where p.active
       and p.locations is not null
       and (l.loc ->> 'lat') is not null
       and (l.loc ->> 'lng') is not null
  ),
  -- In-visit readings: sharp, fresh, trusted, and carrying an offset.
  inside_raw as (
    select v.partner_id,
           coalesce(((regexp_match(coalesce(v.region_id, ''), '-(\d+)$'))[1])::int, 0) as idx,
           e.user_id,
           (e.created_at at time zone 'UTC')::date       as day,
           _gym_detail_num(e.detail, 'dx_m')             as dx,
           _gym_detail_num(e.detail, 'dy_m')             as dy
      from gym_visit_events e
      join gym_visits v on v.id = e.visit_id
     where e.event = 'confirmed_inside'
       and e.created_at > v_since
       and v.partner_id is not null
       and _gym_detail_num(e.detail, 'dx_m') is not null
       and _gym_detail_num(e.detail, 'dy_m') is not null
       and coalesce(_gym_detail_num(e.detail, 'accuracy_m'), 1e9) <= 20
       and coalesce(_gym_detail_num(e.detail, 'fix_age_s'), 0) <= 120
       and e.detail ->> 'fix_trusted' = 'true'
  ),
  -- One vote per member per day.
  inside_votes as (
    select r.partner_id, r.idx, r.user_id, r.day,
           percentile_cont(0.5) within group (order by r.dx) as dx,
           percentile_cont(0.5) within group (order by r.dy) as dy,
           count(*)                                          as n
      from inside_raw r
     group by 1, 2, 3, 4
  ),
  centre as (
    select iv.partner_id, iv.idx,
           count(*)::int                                              as votes,
           count(distinct iv.user_id)::int                            as members,
           sum(iv.n)::int                                             as readings,
           percentile_cont(0.5) within group (order by iv.dx)         as cx,
           percentile_cont(0.5) within group (order by iv.dy)         as cy,
           percentile_cont(0.5) within group (order by sqrt(iv.dx * iv.dx + iv.dy * iv.dy)) as d50,
           percentile_cont(0.9) within group (order by sqrt(iv.dx * iv.dx + iv.dy * iv.dy)) as d90
      from inside_votes iv
     group by 1, 2
  ),
  outside_share as (
    select iv.partner_id, iv.idx,
           avg(case when sqrt(iv.dx * iv.dx + iv.dy * iv.dy) > l.radius_m then 1.0 else 0.0 end) as share
      from inside_votes iv
      join locs l on l.partner_id = iv.partner_id and l.idx = iv.idx
     group by 1, 2
  ),
  -- Phones inside the wake ring that did not check in. Kept apart from the centre.
  miss_raw as (
    select left(r.region_id, 36)::uuid                               as partner_id,
           ((regexp_match(r.region_id, '-(\d+)$'))[1])::int          as idx,
           r.user_id,
           (r.created_at at time zone 'UTC')::date                   as day,
           _gym_detail_num(r.detail, 'dx_m')                         as dx,
           _gym_detail_num(r.detail, 'dy_m')                         as dy,
           sqrt(power(_gym_detail_num(r.detail, 'dx_m'), 2) + power(_gym_detail_num(r.detail, 'dy_m'), 2)) as d
      from geofence_region_events r
     where r.event = 'enter_scan'
       and r.created_at > v_since
       and r.detail ->> 'reason' = 'no_match_in_ring'
       and r.region_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+$'
       and _gym_detail_num(r.detail, 'dx_m') is not null
       and _gym_detail_num(r.detail, 'dy_m') is not null
       and coalesce(_gym_detail_num(r.detail, 'acc_m'), 1e9) <= 20
  ),
  -- One vote per member per day: the reading that came CLOSEST to the pin.
  miss_votes as (
    select distinct on (m.partner_id, m.idx, m.user_id, m.day)
           m.partner_id, m.idx, m.user_id, m.day, m.d, m.dx, m.dy
      from miss_raw m
     order by m.partner_id, m.idx, m.user_id, m.day, m.d
  ),
  misses as (
    select mv.partner_id, mv.idx,
           count(*)::int                                        as votes,
           count(distinct mv.user_id)::int                      as members,
           percentile_cont(0.5) within group (order by mv.d)    as d50,
           percentile_cont(0.5) within group (order by mv.dx)   as mx,
           percentile_cont(0.5) within group (order by mv.dy)   as my
      from miss_votes mv
     group by 1, 2
  ),
  -- ⚠ A venue whose pin is so far off that NOBODY checks in has no in-visit
  -- readings at all — near misses are the only trace it leaves, and it is the
  -- case that matters most. So a venue qualifies on either source.
  keys as (
    select c.partner_id, c.idx from centre c where c.votes >= v_min
    union
    select ms.partner_id, ms.idx from misses ms where ms.votes >= v_min
  )
  select l.partner_id,
         l.idx,
         l.partner_name,
         l.radius_m,
         l.lat,
         l.lng,
         coalesce(c.votes, 0),
         coalesce(c.members, 0),
         coalesce(c.readings, 0),
         round(c.cx::numeric, 1),
         round(c.cy::numeric, 1),
         round(sqrt(c.cx * c.cx + c.cy * c.cy)::numeric, 1),
         round(c.d50::numeric, 1),
         round(c.d90::numeric, 1),
         round(o.share::numeric, 3),
         coalesce(ms.votes, 0),
         coalesce(ms.members, 0),
         round(ms.d50::numeric, 1),
         round(ms.mx::numeric, 1),
         round(ms.my::numeric, 1),
         -- Move the pin onto the MEMBERS' centre — in-visit readings only. A
         -- venue known only from near misses gets no suggestion: those readings
         -- include passers-by, and a pin is not moved on a hint. 111,195 m per
         -- degree of latitude; a degree of longitude shrinks with cos(latitude).
         case when c.votes >= v_min then l.lat + c.cy / 111195.0 end,
         case when c.votes >= v_min then l.lng + c.cx / (111195.0 * cos(radians(l.lat))) end,
         case
           when coalesce(c.votes, 0) < v_min           then 'near misses only'
           when c.votes >= 15 and c.members >= 4       then 'strong'
           when c.votes >= 8  and c.members >= 2       then 'fair'
           else 'weak'
         end
    from keys k
    join locs l on l.partner_id = k.partner_id and l.idx = k.idx
    left join centre c on c.partner_id = k.partner_id and c.idx = k.idx
    left join outside_share o on o.partner_id = k.partner_id and o.idx = k.idx
    left join misses ms on ms.partner_id = k.partner_id and ms.idx = k.idx
   order by greatest(
              coalesce(sqrt(c.cx * c.cx + c.cy * c.cy), 0),
              -- a venue nobody can check into ranks by how far its near misses sit
              case when coalesce(c.votes, 0) < v_min then coalesce(ms.d50, 0) else 0 end
            ) desc,
            coalesce(c.votes, 0) + coalesce(ms.votes, 0) desc;
end;
$$;

revoke all on function public.admin_pin_drift(int, int) from public, anon;
grant execute on function public.admin_pin_drift(int, int) to authenticated;
