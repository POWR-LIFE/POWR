-- =============================================================
-- FEATURED SLOT REQUESTS (What's On)
-- =============================================================
-- Brands can see the featured calendar in the portal but until now
-- had no way to ask for a week — the only route was a support ticket
-- with the dates buried in prose. This table is that ask, structured:
-- a brand names a week and one of its own rewards, an admin approves
-- or declines from the same calendar it schedules on.
--
-- A request reserves NOTHING. Several brands may sit on the same week;
-- scarcity is resolved by the admin, and only on approval does a row
-- land in featured_reward_schedule (where featured_no_overlap makes
-- one-reward-at-a-time a hard guarantee).
--
-- Visibility is deliberately asymmetric: the *schedule* is public
-- (every brand sees who is featured when), but who is BIDDING for a
-- week is commercially sensitive, so a brand sees only its own rows.
-- =============================================================

create table if not exists public.featured_slot_requests (
  id              uuid primary key default gen_random_uuid(),

  -- Portal identity is rewards.brand_name (see 20260612000001), never partners.
  brand_name      text not null,
  reward_id       uuid not null references public.rewards(id) on delete cascade,

  -- Half-open window, matching featured_reward_schedule: Mon 00:00 →
  -- next Mon 00:00 is "the week of".
  requested_start timestamptz not null,
  requested_end   timestamptz not null,
  note            text,

  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined', 'withdrawn')),

  requested_by    uuid references auth.users(id) on delete set null,
  reviewer_notes  text,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,

  -- The schedule row this request became. Null once an admin later
  -- deletes that slot — the request stays 'approved' as a record of
  -- the decision, which is why this is SET NULL and not CASCADE.
  scheduled_id    uuid references public.featured_reward_schedule(id) on delete set null,

  created_at      timestamptz not null default now(),

  constraint featured_slot_requests_window check (requested_end > requested_start)
);

create index if not exists idx_featured_slot_requests_status
  on public.featured_slot_requests (status, requested_start);

create index if not exists idx_featured_slot_requests_brand
  on public.featured_slot_requests (lower(brand_name), created_at desc);

-- One brand, one live ask per week: stops a partner stacking twenty
-- overlapping pending requests on the same window. Withdrawn/declined
-- rows are excluded so they can re-ask after a no.
create extension if not exists btree_gist;

alter table public.featured_slot_requests
  drop constraint if exists featured_slot_requests_one_pending_per_week;
alter table public.featured_slot_requests
  add constraint featured_slot_requests_one_pending_per_week
  exclude using gist (
    (lower(brand_name)) with =,
    tstzrange(requested_start, requested_end, '[)') with &&
  ) where (status = 'pending');

-- ── RLS ───────────────────────────────────────────────────────
alter table public.featured_slot_requests enable row level security;

-- A brand sees its own requests and nobody else's.
drop policy if exists "Brand users read own slot requests" on public.featured_slot_requests;
create policy "Brand users read own slot requests"
  on public.featured_slot_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(featured_slot_requests.brand_name)
    )
  );

-- Insert: own brand, own reward, a future window, and 'pending' only —
-- a partner must never be able to write itself an approval.
drop policy if exists "Brand users insert own slot requests" on public.featured_slot_requests;
create policy "Brand users insert own slot requests"
  on public.featured_slot_requests for insert
  to authenticated
  with check (
    status = 'pending'
    and requested_by = auth.uid()
    and requested_end > now()
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(featured_slot_requests.brand_name)
    )
    and exists (
      select 1 from public.rewards r
      join public.reward_brand_users u on lower(u.brand_name) = lower(r.brand_name)
      where r.id = featured_slot_requests.reward_id
        and u.user_id = auth.uid()
    )
  );

-- Update: only while still pending, and only into pending/withdrawn.
-- The USING clause is what stops a partner touching a decided request.
drop policy if exists "Brand users update own pending slot requests" on public.featured_slot_requests;
create policy "Brand users update own pending slot requests"
  on public.featured_slot_requests for update
  to authenticated
  using (
    status = 'pending'
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(featured_slot_requests.brand_name)
    )
  )
  with check (
    status in ('pending', 'withdrawn')
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(featured_slot_requests.brand_name)
    )
  );

drop policy if exists "Admins manage slot requests" on public.featured_slot_requests;
create policy "Admins manage slot requests"
  on public.featured_slot_requests for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- approve_featured_slot_request
-- =============================================================
-- Approval is three writes that must not come apart: create the
-- schedule row, mark the request approved, and close out every other
-- brand still waiting on a week that has just gone. Doing that from
-- the client would leave a half-approved request behind on any failure.
create or replace function public.approve_featured_slot_request(
  p_request_id     uuid,
  p_reviewer_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req  public.featured_slot_requests;
  v_slot uuid;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_req
    from public.featured_slot_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'That request has already been %', v_req.status using errcode = 'P0001';
  end if;

  -- featured_no_overlap is the source of truth for "one reward at a
  -- time" — surface it as something an admin can act on rather than a
  -- raw constraint name.
  begin
    insert into public.featured_reward_schedule (reward_id, starts_at, ends_at)
    values (v_req.reward_id, v_req.requested_start, v_req.requested_end)
    returning id into v_slot;
  exception when exclusion_violation then
    raise exception 'That window overlaps a slot already on the calendar — clear it first.'
      using errcode = '23P01';
  end;

  update public.featured_slot_requests
     set status         = 'approved',
         scheduled_id   = v_slot,
         reviewed_by    = auth.uid(),
         reviewed_at    = now(),
         reviewer_notes = coalesce(p_reviewer_notes, reviewer_notes)
   where id = p_request_id;

  -- Everyone else who asked for those days is now asking for something
  -- that cannot happen. Decline them here so the queue never shows an
  -- admin a request they can no longer say yes to.
  update public.featured_slot_requests
     set status         = 'declined',
         reviewed_by    = auth.uid(),
         reviewed_at    = now(),
         reviewer_notes = coalesce(reviewer_notes, 'That week was taken before we could confirm your request.')
   where status = 'pending'
     and id <> p_request_id
     and tstzrange(requested_start, requested_end, '[)')
      && tstzrange(v_req.requested_start, v_req.requested_end, '[)');

  return v_slot;
end;
$$;

revoke all on function public.approve_featured_slot_request(uuid, text) from public, anon;
grant execute on function public.approve_featured_slot_request(uuid, text) to authenticated;
