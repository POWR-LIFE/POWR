-- ============================================================================
-- Affiliate readiness: terms acceptance, first share, address-required approval
-- ============================================================================
-- Jamie (2026-08-26): the only HARD gate before an affiliate shares a link is
-- accepting the programme terms (fair play + UK ad-disclosure). Photo/bio are
-- nudges; the postal address is asked for only when a physical reward is
-- actually owed — and admin can no longer approve a parcel into nowhere.

alter table public.creators
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     text,
  add column if not exists first_shared_at   timestamptz;

comment on column public.creators.terms_accepted_at is
  'When the affiliate accepted the programme terms (shared/affiliateTerms.ts). Null = has not; the app and portal gate sharing on it.';

-- Written only through the RPCs below (the creator column grant stays as it is).
create or replace function public.accept_affiliate_terms(p_version text)
returns timestamptz
language plpgsql security definer
set search_path = public
as $$
declare
  v_cid uuid := public.current_creator_id();
  v_now timestamptz := now();
begin
  if v_cid is null then raise exception 'not_an_affiliate'; end if;
  update public.creators
     set terms_accepted_at = v_now, terms_version = coalesce(nullif(trim(p_version), ''), 'unversioned')
   where id = v_cid;
  return v_now;
end;
$$;

create or replace function public.mark_affiliate_shared()
returns timestamptz
language plpgsql security definer
set search_path = public
as $$
declare
  v_cid uuid := public.current_creator_id();
  v_at  timestamptz;
begin
  if v_cid is null then raise exception 'not_an_affiliate'; end if;
  update public.creators
     set first_shared_at = coalesce(first_shared_at, now())
   where id = v_cid
  returning first_shared_at into v_at;
  return v_at;
end;
$$;

revoke all on function public.accept_affiliate_terms(text) from public, anon;
revoke all on function public.mark_affiliate_shared()      from public, anon;
grant execute on function public.accept_affiliate_terms(text) to authenticated;
grant execute on function public.mark_affiliate_shared()      to authenticated;

-- Fulfilment: a step that ships something cannot be approved or shipped
-- without a delivery address on the creator. Points-only steps are untouched.
create or replace function public.admin_update_creator_fulfilment(
  p_creator_id uuid, p_step_id uuid, p_status text,
  p_carrier text default null, p_tracking text default null, p_notes text default null
)
returns public.creator_milestones
language plpgsql security definer set search_path = public
as $$
declare
  v_row  public.creator_milestones;
  v_ships boolean;
  v_addr  jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('owed','approved','shipped','delivered','cancelled') then
    raise exception 'invalid status';
  end if;

  if p_status in ('approved', 'shipped') then
    select (m.creator_reward_id is not null or m.product_sku is not null or m.product_name is not null or m.reward_id is not null),
           c.shipping_address
      into v_ships, v_addr
      from public.creator_milestones m
      join public.creators c on c.id = m.creator_id
     where m.creator_id = p_creator_id and m.step_id = p_step_id;
    if coalesce(v_ships, false) and (v_addr is null or coalesce(v_addr->>'line1', '') = '') then
      raise exception 'address_required';
    end if;
  end if;

  update public.creator_milestones
     set fulfilment_status = p_status,
         carrier         = coalesce(p_carrier, carrier),
         tracking_number = coalesce(p_tracking, tracking_number),
         notes           = coalesce(p_notes, notes),
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         shipped_at  = case when p_status = 'shipped'  then now() else shipped_at  end
   where creator_id = p_creator_id and step_id = p_step_id
  returning * into v_row;
  return v_row;
end;
$$;
