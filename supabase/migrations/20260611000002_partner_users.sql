-- =============================================================
-- PARTNER USERS
-- Links a Supabase auth user to a partner, granting access to
-- the self-service partner portal at /partner/*.
-- Created by admins via the manage-partner-user edge function
-- (inviteUserByEmail + atomic partner_users insert).
-- =============================================================

create table if not exists public.partner_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_users_partner on public.partner_users (partner_id);

alter table public.partner_users enable row level security;

create policy "Partner users read own"
  on public.partner_users for select
  to authenticated
  using (user_id = auth.uid());

create policy "Admins manage partner users"
  on public.partner_users for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- RLS: reward_submissions
-- Partners can read + insert their own; updates only while pending.
-- =============================================================
drop policy if exists "Partner reads own submissions" on public.reward_submissions;
create policy "Partner reads own submissions"
  on public.reward_submissions for select
  to authenticated
  using (
    partner_id in (
      select partner_id from public.partner_users where user_id = auth.uid()
    )
  );

drop policy if exists "Partner insert own submissions" on public.reward_submissions;
create policy "Partner insert own submissions"
  on public.reward_submissions for insert
  to authenticated
  with check (
    partner_id in (
      select partner_id from public.partner_users where user_id = auth.uid()
    )
  );

drop policy if exists "Partner update own pending submissions" on public.reward_submissions;
create policy "Partner update own pending submissions"
  on public.reward_submissions for update
  to authenticated
  using (
    status in ('invited', 'pending')
    and partner_id in (
      select partner_id from public.partner_users where user_id = auth.uid()
    )
  )
  with check (
    status in ('invited', 'pending')
    and partner_id in (
      select partner_id from public.partner_users where user_id = auth.uid()
    )
  );

-- =============================================================
-- RLS: rewards — partners see all their own (including inactive)
-- The existing "Active rewards are publicly readable" policy
-- covers public users; this one covers portal partners.
-- =============================================================
drop policy if exists "Partners read own rewards" on public.rewards;
create policy "Partners read own rewards"
  on public.rewards for select
  to authenticated
  using (
    partner_id in (
      select partner_id from public.partner_users where user_id = auth.uid()
    )
  );

-- =============================================================
-- RLS: redemptions — partners see redemptions for their rewards
-- =============================================================
drop policy if exists "Partners read own redemptions" on public.redemptions;
create policy "Partners read own redemptions"
  on public.redemptions for select
  to authenticated
  using (
    reward_id in (
      select r.id from public.rewards r
      join public.partner_users pu on pu.partner_id = r.partner_id
      where pu.user_id = auth.uid()
    )
  );
