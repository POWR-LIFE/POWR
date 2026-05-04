-- =============================================================
-- FEATURED REWARD SCHEDULE (rewards page)
-- =============================================================
-- Each row pins a reward to the featured slot on the rewards
-- screen for a given date window. The app selects whichever
-- row is currently active (starts_at <= now < ends_at).
-- Overlapping windows are prevented by a DB constraint.

create table public.featured_reward_schedule (
  id         uuid        primary key default gen_random_uuid(),
  reward_id  uuid        not null references public.rewards(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ends_after_starts check (ends_at > starts_at)
);

-- Fast lookup of the active slot
create index featured_reward_schedule_window_idx
  on public.featured_reward_schedule (starts_at, ends_at);

-- RLS: admins manage, public reads
alter table public.featured_reward_schedule enable row level security;

create policy "Public can read featured schedule"
  on public.featured_reward_schedule for select
  using (true);

create policy "Admins can manage featured schedule"
  on public.featured_reward_schedule for all
  using (
    exists (
      select 1 from public.admin_roles
      where user_id = auth.uid()
    )
  );
