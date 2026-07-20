-- Touch coordinates, so the admin panel can paint heat onto a screen rather
-- than only rank screens by name.
--
-- Stored NORMALISED (0..1 of the screen's width/height), never raw pixels. The
-- app runs on everything from an SE to a Pro Max; raw pixels from a mix of
-- devices cannot be overlaid on one screenshot without knowing each device's
-- geometry, whereas a fraction of the way across the screen composites
-- directly onto any reference image. vw/vh are kept alongside only so an
-- unusual aspect ratio can be identified and excluded later.
--
-- Nullable throughout: every event written before this migration has no
-- position, and screen_view events never will.

alter table public.app_events add column if not exists x  real;
alter table public.app_events add column if not exists y  real;
alter table public.app_events add column if not exists vw int;
alter table public.app_events add column if not exists vh int;

-- Anything outside the screen is a bug in the reporter, not a real touch.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_events_xy_normalised') then
    alter table public.app_events add constraint app_events_xy_normalised
      check (
        (x is null or (x >= 0 and x <= 1)) and
        (y is null or (y >= 0 and y <= 1))
      );
  end if;
end $$;

-- The heat query is always "positioned taps on one route in a window".
create index if not exists app_events_route_xy_idx
  on public.app_events (route, created_at desc)
  where x is not null;

comment on column public.app_events.x is 'Touch position across the screen, 0..1 of screen width. Null for screen views and for events recorded before touch capture shipped.';
comment on column public.app_events.y is 'Touch position down the screen, 0..1 of screen height.';

-- Heat points for one screen. Returns raw positions with a weight rather than a
-- pre-built grid: the browser needs the individual points to render smooth
-- blobs, and bucketing here would bake in a resolution the panel cannot undo.
create or replace function public.admin_usage_heatmap(p_route text, p_days int default 30, p_limit int default 4000)
returns table (
  x       real,
  y       real,
  target  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  select e.x, e.y, e.target
  from app_events e
  where e.created_at >= v_since
    and e.x is not null
    and e.route is not null
    -- Tolerate the group syntax expo-router emits on some platforms so
    -- '/(tabs)/progress' and '/progress' resolve to the same screen.
    and regexp_replace(e.route, '/\([^)]*\)', '', 'g') = regexp_replace(p_route, '/\([^)]*\)', '', 'g')
  order by e.created_at desc
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.admin_usage_heatmap(text, int, int) from public, anon;
grant execute on function public.admin_usage_heatmap(text, int, int) to authenticated;
