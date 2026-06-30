-- =============================================================
-- SCHEDULED BROADCASTS + CAMPAIGNS
-- =============================================================
-- Lets admins schedule push broadcasts (and series of them grouped
-- into a named "campaign"/event) for a future calendar date + clock
-- time. Delivery is PER-USER LOCAL TIME: a 09:00 send reaches each
-- user when *their* local clock hits 09:00 on that date. The cron
-- dispatcher fans a single scheduled row out across the distinct
-- timezones present in our user base, sending to each zone once as
-- its local target instant passes.
--
-- Mirrors the existing immediate Broadcast Push (admin-broadcast-push)
-- pipeline + the featured_reward_schedule time-window precedent.

-- Each user's IANA timezone (e.g. 'Europe/London'), written by the app
-- on push-token registration. NULL/unknown falls back to DEFAULT_TZ in
-- the dispatcher so those users still receive the send (London bucket).
alter table public.profiles
  add column if not exists timezone text;

-- ── Campaigns: a named build-up that groups a series of sends ──────────
create table if not exists public.broadcast_campaigns (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  color       text        not null default '#E8D200',  -- calendar dot colour
  created_by  uuid        references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ── A single scheduled push ───────────────────────────────────────────
create table if not exists public.scheduled_broadcasts (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     uuid        references public.broadcast_campaigns(id) on delete set null,
  title           text        not null,
  body            text        not null,
  route           text,
  -- Same audience spec the immediate Broadcast composer produces:
  -- { mode: 'all' | 'segment' | 'users', user_type?, activities?, user_ids? }
  audience        jsonb       not null default '{"mode":"all"}'::jsonb,
  send_date       date        not null,                 -- local calendar date
  send_local_time time        not null default '09:00', -- local clock time
  status          text        not null default 'scheduled'
                    check (status in ('scheduled','sending','sent','cancelled','failed')),
  stats           jsonb,                                -- aggregate result once sent
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists scheduled_broadcasts_due_idx
  on public.scheduled_broadcasts (status, send_date);
create index if not exists scheduled_broadcasts_campaign_idx
  on public.scheduled_broadcasts (campaign_id);

-- ── Per-timezone fan-out tracking (each zone sent exactly once) ────────
create table if not exists public.scheduled_broadcast_dispatches (
  id                     uuid        primary key default gen_random_uuid(),
  scheduled_broadcast_id uuid        not null references public.scheduled_broadcasts(id) on delete cascade,
  timezone               text        not null,
  dispatched_at          timestamptz not null default now(),
  recipients             int         not null default 0,
  delivered              int         not null default 0,
  failed                 int         not null default 0,
  pruned                 int         not null default 0,
  unique (scheduled_broadcast_id, timezone)
);

-- ── RLS: admins manage; service-role (dispatcher) bypasses RLS ─────────
alter table public.broadcast_campaigns            enable row level security;
alter table public.scheduled_broadcasts           enable row level security;
alter table public.scheduled_broadcast_dispatches enable row level security;

create policy "Admins manage campaigns"
  on public.broadcast_campaigns for all
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

create policy "Admins manage scheduled broadcasts"
  on public.scheduled_broadcasts for all
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

create policy "Admins read dispatches"
  on public.scheduled_broadcast_dispatches for select
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- ── Due (message, timezone) pairs the dispatcher should send right now ─
-- A zone is "due" for a scheduled row when that row's local wall-clock
-- target (send_date + send_local_time, interpreted in the zone) has
-- passed and no dispatch row exists yet. The zone set is the distinct
-- profile timezones plus the default bucket (covering NULL/unknown).
create or replace function public.due_broadcast_dispatches()
returns table (scheduled_broadcast_id uuid, timezone text)
language sql
security definer
set search_path = public
as $$
  with zones as (
    select distinct coalesce(nullif(p.timezone, ''), 'Europe/London') as tz
    from public.profiles p
    union
    select 'Europe/London'
  )
  select sb.id, z.tz
  from public.scheduled_broadcasts sb
  cross join zones z
  where sb.status in ('scheduled','sending')
    and (sb.send_date + sb.send_local_time) at time zone z.tz <= now()
    and not exists (
      select 1 from public.scheduled_broadcast_dispatches d
      where d.scheduled_broadcast_id = sb.id and d.timezone = z.tz
    );
$$;

-- Total distinct zones currently in the user base (incl. default bucket).
-- The dispatcher marks a scheduled row 'sent' once it has a dispatch row
-- for every zone (i.e. the westernmost zone has finally fired).
create or replace function public.broadcast_zone_count()
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int from (
    select distinct coalesce(nullif(p.timezone, ''), 'Europe/London') as tz
    from public.profiles p
    union
    select 'Europe/London'
  ) z;
$$;

grant execute on function public.due_broadcast_dispatches() to service_role;
grant execute on function public.broadcast_zone_count()     to service_role;
