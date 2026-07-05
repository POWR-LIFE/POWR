-- =============================================================
-- REWARD PLACEMENTS  (location/time-targeted reward surfacing)
-- =============================================================
-- Phase 0 of the "invisible geofence" reward-targeting system.
--
-- A *placement* ties an existing reward to a geographic + temporal +
-- audience context. When a user is inside the placement's fence during
-- its flight window, the reward is boosted (or, later, made exclusively
-- visible) in their vault.
--
-- Deliberately modelled from day one to support PAID placements so a
-- paying partner slots in by flipping `paid = true` — no re-architecture.
-- Until then, all placements are first-party (`paid = false`).
--
-- IMPORTANT: these fences are COARSE (venue-scale, e.g. a whole golf
-- course). They are a separate class from the 25 m points-integrity
-- geofence and must NEVER feed the claim/points path.
-- =============================================================

create table public.reward_placements (
  id                uuid primary key default gen_random_uuid(),
  reward_id         uuid not null references public.rewards(id) on delete cascade,

  -- ── Ownership / monetization ───────────────────────────────
  -- partner_id = who owns/pays for this placement (null = first-party POWR).
  -- `paid` is what flips a first-party surface into advertising: it drives
  -- the "Sponsored" tag and is the billing signal. Leave false for Phase 0.
  partner_id        uuid references public.partners(id) on delete set null,
  paid              boolean not null default false,

  -- ── Geo target ─────────────────────────────────────────────
  --   'fence'         : an explicit coarse circle (center + radius_m)
  --   'partner_venue' : reuse an existing partner's locations[] (radius_m overrides per-loc radius)
  --   'poi_category'  : match a place category (e.g. 'golf_course') — reserved; needs a POI data layer
  geo_mode          text not null default 'fence'
                       check (geo_mode in ('fence', 'partner_venue', 'poi_category')),
  center_lat        double precision,
  center_lng        double precision,
  radius_m          integer,
  target_partner_id uuid references public.partners(id) on delete cascade,
  poi_category      text,

  -- ── Visibility mechanic ────────────────────────────────────
  --   'boost'     : reorder a reward the user can already see to the front
  --   'exclusive' : reward only appears while in-context (client wiring is a later increment)
  visibility        text not null default 'boost'
                       check (visibility in ('boost', 'exclusive')),
  priority          integer not null default 0,   -- higher wins ties (bid proxy)

  -- ── Time targeting (matched against DEVICE-LOCAL time) ──────
  starts_at         timestamptz,                   -- flight window (null = open-ended)
  ends_at           timestamptz,
  active_days       smallint[],                    -- 0-6 (Sun-Sat); null = any day
  active_hour_start smallint,                      -- 0-23 local; null = any hour. Supports overnight (start > end)
  active_hour_end   smallint,

  -- ── Frequency capping ──────────────────────────────────────
  max_impressions_per_user_per_day smallint,       -- null = unlimited (rolling 24h of 'surfaced' events)

  -- ── Audience targeting ─────────────────────────────────────
  target_activities text[],                        -- overlaps profiles.activity_preferences; null = everyone

  -- ── Lifecycle ──────────────────────────────────────────────
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint reward_placements_geo_check check (
    (geo_mode = 'fence'         and center_lat is not null and center_lng is not null and radius_m is not null)
    or (geo_mode = 'partner_venue' and target_partner_id is not null)
    or (geo_mode = 'poi_category'  and poi_category is not null)
  )
);

create index reward_placements_active_idx
  on public.reward_placements (active)
  where active = true;

create index reward_placements_reward_id_idx
  on public.reward_placements (reward_id);

-- =============================================================
-- ATTRIBUTION / BILLING / FREQUENCY-CAP EVENT LOG
-- =============================================================
-- One row per moment in the funnel. This is simultaneously:
--   • the frequency-cap substrate (count 'surfaced' in last 24h),
--   • the billing substrate (paid placements charge on outcomes), and
--   • the sales/measurement dashboard (surfaced → present → redeemed).
-- =============================================================

create table public.reward_placement_events (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.reward_placements(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  event_type   text not null
                 check (event_type in ('surfaced', 'presence_confirmed', 'redeemed')),
  lat          double precision,
  lng          double precision,
  created_at   timestamptz not null default now()
);

-- Frequency-cap + funnel lookups
create index reward_placement_events_cap_idx
  on public.reward_placement_events (placement_id, user_id, event_type, created_at desc);

create index reward_placement_events_funnel_idx
  on public.reward_placement_events (placement_id, event_type, created_at desc);

-- =============================================================
-- RLS
-- =============================================================
alter table public.reward_placements       enable row level security;
alter table public.reward_placement_events enable row level security;

-- Placements are read/written only via the resolver RPC (definer) or admin
-- tooling. No direct public read — the RPC decides what a user may see.
-- Gated on admin_roles to match the web admin panel's proven write path
-- (same check as featured_reward_schedule); admin_roles is kept in sync with
-- profiles.is_admin by trigger.
create policy "Admins manage reward placements"
  on public.reward_placements for all
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- Users may log their own funnel events; they cannot read others'.
create policy "Users log their own placement events"
  on public.reward_placement_events for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users read their own placement events"
  on public.reward_placement_events for select
  to authenticated
  using (user_id = auth.uid());

create policy "Admins read all placement events"
  on public.reward_placement_events for select
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- RESOLVER RPC
-- =============================================================
-- Given a user's COARSE location and their DEVICE-LOCAL day/hour, returns
-- the placements that apply right now for auth.uid(): inside the fence,
-- within the flight window + local day/hour, matching activity preferences,
-- and under the per-user daily frequency cap. Ordered paid-first, then by
-- priority, then nearest. The client merges these into the vault (boost).
--
-- SECURITY DEFINER so it can read the profile's activity_preferences and
-- the frequency-cap event history without exposing those tables directly.
-- =============================================================
create or replace function public.resolve_reward_placements(
  p_lat        double precision,
  p_lng        double precision,
  p_local_dow  smallint default null,   -- 0-6 (Sun-Sat), device-local; null skips day filter
  p_local_hour smallint default null    -- 0-23, device-local; null skips hour filter
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
      pl.id,
      pl.reward_id,
      pl.visibility,
      pl.priority,
      pl.paid,
      pl.partner_id,
      pl.target_activities,
      pl.max_impressions_per_user_per_day,
      case
        when pl.geo_mode = 'partner_venue' then coalesce(pl.radius_m, 150)
        else pl.radius_m
      end as eff_radius_m,
      case
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
          from public.partners tp,
               jsonb_array_elements(tp.locations) as loc
          where tp.id = pl.target_partner_id
            and loc->>'lat' is not null
            and loc->>'lng' is not null
        )
        else null   -- poi_category: no data layer yet
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
    and c.dist_m <= c.eff_radius_m
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

revoke all on function public.resolve_reward_placements(double precision, double precision, smallint, smallint) from public, anon;
grant execute on function public.resolve_reward_placements(double precision, double precision, smallint, smallint) to authenticated;
