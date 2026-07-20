-- =============================================================
-- REWARD AUTHORING READINESS + PARTNER CODE RECONCILIATION
-- Partners can save reward work as drafts, revise rejected submissions,
-- describe the intended fulfilment path, and reconcile codes used in their
-- own commerce system without receiving broad redemption-ledger access.
-- =============================================================

alter table public.reward_submissions
  drop constraint if exists reward_submissions_status_check;

alter table public.reward_submissions
  add constraint reward_submissions_status_check
    check (status in ('invited', 'draft', 'pending', 'approved', 'rejected'));

alter table public.reward_submissions
  add column if not exists delivery_method text not null default 'code_pool'
    check (delivery_method in ('code_pool', 'affiliate', 'manual_fulfilment')),
  add column if not exists fulfilment_notes text,
  add column if not exists stock integer
    check (stock is null or stock >= 0),
  add column if not exists max_redemptions_per_user integer
    check (max_redemptions_per_user is null or max_redemptions_per_user > 0),
  add column if not exists partner_feedback text,
  add column if not exists internal_notes text,
  add column if not exists updated_at timestamptz not null default now();

-- Preserve existing reviewer comments as partner-visible feedback. Before this
-- migration, the partner portal displayed reviewer_notes despite labelling it
-- "internal" in the admin UI.
update public.reward_submissions
   set partner_feedback = reviewer_notes
 where partner_feedback is null
   and reviewer_notes is not null;

drop policy if exists "Brand users update own pending submissions" on public.reward_submissions;
create policy "Brand users update own editable submissions"
  on public.reward_submissions for update
  to authenticated
  using (
    status in ('invited', 'draft', 'pending', 'rejected')
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(reward_submissions.brand_name)
    )
  )
  with check (
    status in ('draft', 'pending')
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(reward_submissions.brand_name)
    )
    and (
      target_reward_id is null
      or target_reward_id in (
        select r.id from public.rewards r
        join public.reward_brand_users u on lower(u.brand_name) = lower(r.brand_name)
        where u.user_id = auth.uid()
      )
    )
  );

-- A partner can only confirm codes that POWR has already assigned to a member.
-- The RPC is deliberately one-way: it cannot release a code or change a code
-- that has not entered the member redemption flow.
create or replace function public.reconcile_partner_redemption_codes(
  p_reward_id uuid,
  p_codes text[],
  p_used_at timestamptz default now()
)
returns table (
  submitted_count integer,
  matched_count integer,
  marked_used_count integer,
  already_used_count integer,
  unavailable_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes text[];
begin
  if not exists (
    select 1
      from public.rewards r
      join public.reward_brand_users u on lower(u.brand_name) = lower(r.brand_name)
     where r.id = p_reward_id
       and u.user_id = auth.uid()
  ) and not exists (
    select 1 from public.admin_roles where user_id = auth.uid()
  ) then
    raise exception 'You cannot reconcile codes for this reward';
  end if;

  select coalesce(array_agg(distinct upper(trim(code))), '{}')
    into v_codes
    from unnest(coalesce(p_codes, '{}')) as code
   where trim(code) <> '';

  if cardinality(v_codes) > 5000 then
    raise exception 'A reconciliation upload can contain at most 5,000 codes';
  end if;

  return query
  with matched as (
    select rc.id, rc.status
      from public.redemption_codes rc
     where rc.reward_id = p_reward_id
       and rc.code = any(v_codes)
     for update
  ), updated as (
    update public.redemption_codes rc
       set status = 'used',
           used_at = least(coalesce(p_used_at, now()), now())
      from matched m
     where rc.id = m.id
       and m.status = 'reserved'
    returning rc.id
  )
  select
    cardinality(v_codes)::integer,
    (select count(*)::integer from matched),
    (select count(*)::integer from updated),
    (select count(*)::integer from matched where status = 'used'),
    (select count(*)::integer from matched where status not in ('reserved', 'used'));
end;
$$;

revoke all on function public.reconcile_partner_redemption_codes(uuid, text[], timestamptz) from public, anon;
grant execute on function public.reconcile_partner_redemption_codes(uuid, text[], timestamptz) to authenticated;