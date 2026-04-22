-- =============================================================
-- PROMO CODE REDEMPTION SYSTEM
-- Two-tier: POOL (partner pre-uploads) + API_VALIDATED (POWR mints)
-- Every code is unique per redemption. Ledger integrity is enforced
-- by the UNIQUE constraint on redemption_codes.code.
-- =============================================================

-- Extend partners
alter table public.partners
  add column if not exists partner_code text,
  add column if not exists checkout_url_template text;

-- Backfill partner_code from slugified name, suffixing duplicates so the
-- unique index below succeeds even when two partners share a name prefix.
with base as (
  select id,
         upper(substring(regexp_replace(name, '[^A-Za-z0-9]', '', 'g') from 1 for 4)) as code
    from public.partners
   where partner_code is null
), numbered as (
  select id, code,
         row_number() over (partition by code order by id) as rn
    from base
)
update public.partners p
   set partner_code = case when n.rn = 1 then n.code
                           else substring(n.code from 1 for 3) || n.rn::text end
  from numbered n
 where p.id = n.id;

alter table public.partners
  alter column partner_code set not null;

create unique index if not exists partners_partner_code_key
  on public.partners (partner_code);

-- Extend rewards
do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_integration_type') then
    create type public.reward_integration_type as enum ('POOL', 'API_VALIDATED');
  end if;
end$$;

alter table public.rewards
  add column if not exists integration_type public.reward_integration_type not null default 'POOL',
  add column if not exists code_expiry_days int not null default 90;

-- =============================================================
-- Code pool (both tiers use this table; differentiated by `source`)
-- =============================================================
create table if not exists public.redemption_codes (
  id                uuid primary key default gen_random_uuid(),
  reward_id         uuid not null references public.rewards(id) on delete cascade,
  code              text not null unique,
  source            text not null check (source in ('PARTNER_UPLOAD', 'POWR_GENERATED')),
  status            text not null default 'available'
                      check (status in ('available','reserved','used','expired')),
  assigned_user_id  uuid references public.profiles(id),
  assigned_at       timestamptz,
  used_at           timestamptz,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_codes_pool on public.redemption_codes (reward_id, status);

alter table public.redemption_codes enable row level security;
-- Service role only. No client-side policies.

-- =============================================================
-- Redemption ledger — rebuild to the new shape
-- Existing redemptions table was a lightweight stub; migrate to richer schema.
-- =============================================================

-- Drop old status enum dependency by widening to text
alter table public.redemptions
  add column if not exists code_id uuid references public.redemption_codes(id),
  add column if not exists integration_type text,
  add column if not exists powr_spent int,
  add column if not exists expires_at timestamptz;

-- Convert status from enum to text to allow 'refunded'
alter table public.redemptions
  alter column status drop default,
  alter column status type text using status::text,
  alter column status set default 'active';

-- Drop the old enum if nothing else uses it
do $$
begin
  if exists (select 1 from pg_type where typname = 'redemption_status') then
    -- Safe only if no other column uses it
    begin
      drop type public.redemption_status;
    exception when dependent_objects_still_exist then
      null;
    end;
  end if;
end$$;

alter table public.redemptions
  drop constraint if exists redemptions_status_check;
alter table public.redemptions
  add constraint redemptions_status_check
    check (status in ('active','used','expired','refunded'));

-- =============================================================
-- Partner API keys (upload codes / validate codes)
-- =============================================================
create table if not exists public.partner_api_keys (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  key_hash    text not null,
  scopes      text[] not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

alter table public.partner_api_keys enable row level security;
-- Service role only.

-- =============================================================
-- Atomic pool code claim — FOR UPDATE SKIP LOCKED prevents two users
-- grabbing the same code under concurrent redemption.
-- =============================================================
create or replace function public.claim_pool_code(
  p_reward_id uuid,
  p_user_id   uuid
) returns table (id uuid, code text)
language plpgsql
security definer
as $$
declare
  v_id   uuid;
  v_code text;
begin
  select rc.id, rc.code into v_id, v_code
    from public.redemption_codes rc
   where rc.reward_id = p_reward_id
     and rc.status = 'available'
     and rc.expires_at > now()
   order by rc.created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.redemption_codes
     set status = 'reserved',
         assigned_user_id = p_user_id,
         assigned_at = now()
   where redemption_codes.id = v_id;

  return query select v_id, v_code;
end;
$$;

revoke all on function public.claim_pool_code(uuid, uuid) from public, anon, authenticated;
-- Service role only.
