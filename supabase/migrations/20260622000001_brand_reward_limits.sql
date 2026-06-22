-- =============================================================
-- BRAND REWARD LIMITS
-- Per-brand cap on how many rewards a brand can have in flight
-- (live rewards + new submissions still in review). Admin-managed
-- via a counter in the Reward Vault; enforced server-side with a
-- trigger so the client-side cap cannot be bypassed.
-- =============================================================

create table if not exists public.brand_reward_limits (
  brand_key    text        primary key,            -- lower(trim(brand_name)) — canonical key
  brand_name   text        not null,               -- display casing
  reward_limit int         not null default 2 check (reward_limit >= 0 and reward_limit <= 100),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references public.profiles(id) on delete set null
);

-- ── Row-level security ───────────────────────────────────────
alter table public.brand_reward_limits enable row level security;

-- Admins manage every brand's limit
create policy "Admins manage brand reward limits"
  on public.brand_reward_limits for all
  using (exists (select 1 from public.admin_roles where admin_roles.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where admin_roles.user_id = auth.uid()));

-- Brand users can read their own brand's limit (so the portal shows the right cap)
create policy "Brand users read own reward limit"
  on public.brand_reward_limits for select
  using (
    exists (
      select 1 from public.reward_brand_users rbu
      where rbu.user_id = auth.uid()
        and lower(trim(rbu.brand_name)) = brand_reward_limits.brand_key
    )
  );

-- ── Enforcement trigger ──────────────────────────────────────
-- Blocks a brand from creating a new reward submission once its live
-- rewards + in-review submissions reach the limit. Listing-update change
-- requests and rejected rows are exempt; admin-initiated inserts bypass
-- the cap (admins raise the limit explicitly instead).
create or replace function public.enforce_brand_reward_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_key   text := lower(trim(coalesce(new.brand_name, '')));
  v_limit int;
  v_count int;
begin
  if new.target_reward_id is not null then return new; end if;  -- listing edit, not a new reward
  if new.status = 'rejected' then return new; end if;
  if v_key = '' then return new; end if;

  -- Admins (intake / invite flows) bypass the cap.
  if exists (select 1 from public.admin_roles where admin_roles.user_id = auth.uid()) then
    return new;
  end if;

  select coalesce(brl.reward_limit, 2) into v_limit
  from (select 1) one
  left join public.brand_reward_limits brl on brl.brand_key = v_key;

  select
      (select count(*) from public.rewards r
         where lower(trim(coalesce(r.brand_name, ''))) = v_key)
    + (select count(*) from public.reward_submissions s
         where lower(trim(coalesce(s.brand_name, ''))) = v_key
           and s.target_reward_id is null
           and s.status in ('pending', 'invited'))
  into v_count;

  if v_count >= v_limit then
    raise exception 'Reward limit reached: % already has % reward(s) live or in review (limit %).',
      new.brand_name, v_count, v_limit
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Trigger functions are never called directly by clients.
revoke execute on function public.enforce_brand_reward_limit() from public, anon, authenticated;

create trigger trg_enforce_brand_reward_limit
  before insert on public.reward_submissions
  for each row execute function public.enforce_brand_reward_limit();
