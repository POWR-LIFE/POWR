-- In-app activity feed.
--
-- A durable, per-user log of the notification-worthy things that happen across
-- the app — shared-challenge outcomes (completed / expiring / friend finished /
-- pool milestone / accepted / started), friend-accepted, reward unlocks, points
-- milestones, recorded gym sessions, sleep goals and admin announcements.
--
-- Until now these moments existed only as ephemeral push notifications: if a
-- user missed (or never enabled) push, the moment was gone. Rows here back the
-- "Recent" tab on the in-app Activity screen so there is a persistent home for
-- them, independent of whether a device push ever landed.
--
-- Written exclusively by service-role edge functions (send-push-notification at
-- the push chokepoint, admin-broadcast-push for announcements). Clients only
-- ever read their own rows and flip read_at — enforced by RLS below.

create table if not exists public.user_activity (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The push/notification type this row mirrors (e.g. 'challenge_completed',
  -- 'reward_unlocked', 'session_completed', 'announcement'). Free text so new
  -- event types never need a migration.
  type        text not null,
  -- Coarse bucket the client renders an icon/accent from.
  category    text not null default 'system'
                check (category in ('social', 'rewards', 'activity', 'system')),
  title       text not null,
  body        text not null,
  -- In-app route / deep link to open on tap (e.g. '/shared-challenge?id=…').
  route       text,
  -- Remaining push payload (ids etc.) for rendering / future deep-linking.
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Feed render: newest-first per user.
create index if not exists user_activity_user_created_idx
  on public.user_activity (user_id, created_at desc);

-- Unread-count badge: only the unread rows per user.
create index if not exists user_activity_unread_idx
  on public.user_activity (user_id)
  where read_at is null;

alter table public.user_activity enable row level security;

-- Read your own feed.
drop policy if exists "user_activity_select_own" on public.user_activity;
create policy "user_activity_select_own"
  on public.user_activity for select
  using (user_id = auth.uid());

-- Flip read_at on your own rows (mark-as-read). No insert/delete policy: only
-- the service role (which bypasses RLS) writes rows.
drop policy if exists "user_activity_update_own" on public.user_activity;
create policy "user_activity_update_own"
  on public.user_activity for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Helpers ────────────────────────────────────────────────────────────────
-- Unread count for the header bell badge. SECURITY DEFINER + authenticated-only
-- to match the 0028/0029 lockdown; reads only the caller's own rows.
create or replace function public.get_unread_activity_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.user_activity
  where user_id = auth.uid()
    and read_at is null;
$$;

-- Mark the caller's whole feed read in one round trip (called when the Activity
-- screen is opened). Returns the number of rows flipped.
create or replace function public.mark_all_activity_read()
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with updated as (
    update public.user_activity
    set read_at = now()
    where user_id = auth.uid()
      and read_at is null
    returning 1
  )
  select count(*)::int from updated;
$$;

grant execute on function public.get_unread_activity_count() to authenticated;
grant execute on function public.mark_all_activity_read() to authenticated;
revoke execute on function public.get_unread_activity_count() from public, anon;
revoke execute on function public.mark_all_activity_read() from public, anon;
