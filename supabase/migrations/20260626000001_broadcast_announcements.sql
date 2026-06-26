-- Admin broadcast push: a free-form, all-users push sent from the admin panel.
-- Reuses the existing user_push_tokens → Expo pipeline, so it reaches every
-- installed device regardless of app version. Two pieces:
--   1. an `announcements` opt-out on notification_preferences (App Store 4.5.4:
--      users must be able to opt out of promotional pushes), and
--   2. a broadcast_log audit table.

-- 1. Opt-out toggle. Defaults true; Postgres backfills existing rows with the
--    default, so every current user is opted in until they turn it off.
alter table public.notification_preferences
  add column if not exists announcements boolean not null default true;

-- 2. Audit log of every broadcast sent.
create table if not exists public.broadcast_log (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references auth.users(id) on delete set null,
  title         text not null,
  body          text not null,
  route         text,
  audience      jsonb,           -- the targeting spec used (mode + filters)
  recipients    integer not null default 0,
  tickets_ok    integer not null default 0,
  tickets_error integer not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.broadcast_log enable row level security;

-- Admins (admin_roles) can read the broadcast history in the panel. Writes go
-- through the service-role edge function, which bypasses RLS.
create policy "admins read broadcast log"
  on public.broadcast_log
  for select
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

create index if not exists idx_broadcast_log_created_at
  on public.broadcast_log (created_at desc);
