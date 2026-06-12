-- =============================================================
-- LISTING EDIT REQUESTS
-- A reward_submission with target_reward_id set is an edit
-- request for an existing live reward (submitted by the partner
-- via the portal). On admin approval the changes are applied to
-- the live reward in place instead of creating a new one.
-- =============================================================

alter table public.reward_submissions
  add column if not exists target_reward_id uuid references public.rewards(id) on delete cascade;

-- Tighten partner policies: a partner may only target their own rewards.
drop policy if exists "Partner insert own submissions" on public.reward_submissions;
create policy "Partner insert own submissions"
  on public.reward_submissions for insert
  to authenticated
  with check (
    partner_id in (
      select partner_id from public.partner_users where user_id = auth.uid()
    )
    and (
      target_reward_id is null
      or target_reward_id in (
        select r.id from public.rewards r
        join public.partner_users pu on pu.partner_id = r.partner_id
        where pu.user_id = auth.uid()
      )
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
    and (
      target_reward_id is null
      or target_reward_id in (
        select r.id from public.rewards r
        join public.partner_users pu on pu.partner_id = r.partner_id
        where pu.user_id = auth.uid()
      )
    )
  );
