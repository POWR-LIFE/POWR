-- =============================================================
-- REWARD PLACEMENTS → affordability + recent-activity targeting
-- =============================================================
--  affordability: only surface to users who can afford / are close to
--                 affording the reward (balance vs rewards.powr_cost).
--  activity_recency: target users by recent activity_sessions — 'active'
--                 (has a session within N hours, e.g. just left the gym)
--                 or 'lapsed' (no session in N hours, re-engagement).
-- =============================================================

alter table public.reward_placements
  add column if not exists affordability text not null default 'any'
    check (affordability in ('any', 'affordable', 'within_reach')),
  add column if not exists activity_recency text not null default 'any'
    check (activity_recency in ('any', 'active', 'lapsed')),
  add column if not exists activity_window_hours integer;

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
  bal as (
    select coalesce(sum(amount), 0)::numeric as pts
    from public.point_transactions
    where user_id = auth.uid()
  ),
  candidates as (
    select
      pl.id, pl.reward_id, pl.visibility, pl.priority, pl.paid, pl.partner_id,
      pl.target_activities, pl.max_impressions_per_user_per_day,
      pl.affordability, pl.activity_recency, pl.activity_window_hours,
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
  cross join bal b
  where c.dist_m is not null
    and (c.eff_radius_m is null or c.dist_m <= c.eff_radius_m)
    and (
      c.target_activities is null
      or (me.activity_preferences is not null and c.target_activities && me.activity_preferences::text[])
    )
    -- affordability
    and (
      c.affordability = 'any'
      or (c.affordability = 'affordable'   and b.pts >= r.powr_cost)
      or (c.affordability = 'within_reach' and b.pts >= 0.6 * r.powr_cost)
    )
    -- recent activity moment
    and (
      c.activity_recency = 'any' or c.activity_window_hours is null
      or (c.activity_recency = 'active' and exists (
        select 1 from public.activity_sessions s
        where s.user_id = auth.uid()
          and s.started_at >= now() - make_interval(hours => c.activity_window_hours)
      ))
      or (c.activity_recency = 'lapsed' and not exists (
        select 1 from public.activity_sessions s
        where s.user_id = auth.uid()
          and s.started_at >= now() - make_interval(hours => c.activity_window_hours)
      ))
    )
    -- daily frequency cap
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
