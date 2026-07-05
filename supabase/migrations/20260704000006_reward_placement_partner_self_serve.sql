-- =============================================================
-- REWARD PLACEMENTS → partner self-serve (brand-scoped RLS)
-- =============================================================
-- Until now placements were admin-only (gated on admin_roles) — created
-- from the web admin panel. This opens a *self-serve* path so a reward
-- brand, logged into the partner portal, can create/edit placements for
-- their OWN rewards without any admin involvement.
--
-- Ownership link: reward_brand_users(user_id, brand_name) ↔ rewards.brand_name
-- (case/space-insensitive, matching how the portal resolves a brand).
--
-- Brand-created rows are locked to the self-serve shape: geo_mode='grid',
-- visibility='boost', priority=0, paid=true (they are Sponsored), and no
-- partner_id (partners = gyms, unrelated). The POWR-only levers (priority
-- bidding, exclusive visibility, first-party unpaid) stay admin-only.
--
-- The whole surface is gated in the client behind the system_config flag
-- `partner_placements_enabled` (added below, default OFF) so nothing is
-- exposed to real brands until we're ready + payments are wired. Admins
-- always see it (for testing) regardless of the flag.
-- =============================================================

-- ── Ownership helper ─────────────────────────────────────────────────────────
-- True when the calling user is a brand user for the reward's brand.
-- SECURITY DEFINER so it can read reward_brand_users/rewards regardless of
-- the caller's own RLS (it only ever answers about auth.uid()).
create or replace function public.user_owns_reward_brand(p_reward_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rewards r
    join public.reward_brand_users bu
      on lower(btrim(bu.brand_name)) = lower(btrim(r.brand_name))
    where r.id = p_reward_id
      and r.brand_name is not null
      and bu.user_id = auth.uid()
  );
$$;

revoke all on function public.user_owns_reward_brand(uuid) from public, anon;
grant execute on function public.user_owns_reward_brand(uuid) to authenticated;

-- ── reward_placements: brand owners manage their own reward's placements ─────
-- Additive to the existing admin "for all" policy (permissive policies OR
-- together): admins stay unrestricted, brands get the locked-shape path.
create policy "Brands read own reward placements"
  on public.reward_placements for select
  to authenticated
  using (public.user_owns_reward_brand(reward_id));

create policy "Brands insert own reward placements"
  on public.reward_placements for insert
  to authenticated
  with check (
    public.user_owns_reward_brand(reward_id)
    and geo_mode  = 'grid'
    and visibility = 'boost'
    and priority   = 0
    and paid       = true
    and partner_id is null
  );

create policy "Brands update own reward placements"
  on public.reward_placements for update
  to authenticated
  using (public.user_owns_reward_brand(reward_id))
  with check (
    public.user_owns_reward_brand(reward_id)
    and geo_mode  = 'grid'
    and visibility = 'boost'
    and priority   = 0
    and paid       = true
    and partner_id is null
  );

create policy "Brands delete own reward placements"
  on public.reward_placements for delete
  to authenticated
  using (public.user_owns_reward_brand(reward_id));

-- ── reward_placement_cells: read/manage cells of owned placements ────────────
-- Writes go through set_placement_cells (definer, bypasses RLS); this policy
-- mainly powers the partner page's direct reads (cell counts, edit preload).
create policy "Brands manage own placement cells"
  on public.reward_placement_cells for all
  to authenticated
  using (exists (
    select 1 from public.reward_placements p
    where p.id = reward_placement_cells.placement_id
      and public.user_owns_reward_brand(p.reward_id)
  ))
  with check (exists (
    select 1 from public.reward_placements p
    where p.id = reward_placement_cells.placement_id
      and public.user_owns_reward_brand(p.reward_id)
  ));

-- ── set_placement_cells: allow admin OR the reward's brand owner ─────────────
-- (Body unchanged apart from the auth gate: was NOT_ADMIN, now NOT_AUTHORIZED
-- for anyone who is neither an admin nor the owning brand.)
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
  v_reward uuid;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_mask   bit(168);
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

revoke all on function public.set_placement_cells(uuid, integer[]) from public, anon;
grant execute on function public.set_placement_cells(uuid, integer[]) to authenticated;

-- ── get_taken_grid_cells: allow admins OR any brand user ─────────────────────
-- Only reveals which map squares are occupied (not by whom) in a viewport,
-- which is exactly what a brand needs to avoid double-booking a time slice.
create or replace function public.get_taken_grid_cells(
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
  where (
      exists (select 1 from public.admin_roles       where user_id = auth.uid())
      or exists (select 1 from public.reward_brand_users where user_id = auth.uid())
    )
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

revoke all on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.get_taken_grid_cells(double precision, double precision, double precision, double precision, uuid, timestamptz, timestamptz, text) to authenticated;

-- ── Feature flag ─────────────────────────────────────────────────────────────
-- Default OFF. Flip to 'true' in admin → System Config to expose the partner
-- Placements page to real brand users. Admins always see it regardless.
insert into public.system_config (key, value, description)
values (
  'partner_placements_enabled',
  'false',
  'When true, reward brands see the self-serve Placements page in the partner portal. Admins always see it for testing.'
)
on conflict (key) do nothing;

-- system_config SELECT is otherwise admin-only; expose just this one flag to
-- authenticated brand users so the portal can decide whether to show the page.
create policy "Authenticated can read placements feature flag"
  on public.system_config for select
  to authenticated
  using (key = 'partner_placements_enabled');
