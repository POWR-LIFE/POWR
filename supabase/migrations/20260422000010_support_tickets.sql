-- =============================================================
-- SUPPORT TICKETS
-- In-app support system. Users submit categorised messages;
-- admins can view, triage, and reply from the admin dashboard.
-- =============================================================

create table if not exists public.support_tickets (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references public.profiles(id) on delete set null,
  email        text        not null,
  category     text        not null,
  subject      text        not null,
  message      text        not null,
  status       text        not null default 'open'
                           check (status in ('open','in_progress','resolved','closed')),
  admin_reply  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Keep updated_at fresh on every update
create or replace function public.support_tickets_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.support_tickets_set_updated_at();

-- ── Row-level security ───────────────────────────────────────
alter table public.support_tickets enable row level security;

-- Users can submit their own tickets
create policy "Users can insert own tickets"
  on public.support_tickets for insert
  with check (auth.uid() = user_id);

-- Users can read their own tickets
create policy "Users can read own tickets"
  on public.support_tickets for select
  using (auth.uid() = user_id);

-- Admins (via admin_roles table) can read all tickets
create policy "Admins can read all tickets"
  on public.support_tickets for select
  using (
    exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = auth.uid()
    )
  );

-- Admins can update status + reply
create policy "Admins can update tickets"
  on public.support_tickets for update
  using (
    exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = auth.uid()
    )
  );

-- ── Index for common query patterns ─────────────────────────
create index if not exists support_tickets_user_id_idx  on public.support_tickets (user_id);
create index if not exists support_tickets_status_idx   on public.support_tickets (status);
create index if not exists support_tickets_created_idx  on public.support_tickets (created_at desc);
