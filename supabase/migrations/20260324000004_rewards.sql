-- =============================================================
-- PARTNERS, REWARDS, REDEMPTIONS
-- =============================================================

create type public.partner_category as enum (
  'fashion', 'gear', 'nutrition', 'gym', 'food', 'health'
);

create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  category    public.partner_category not null,
  locations   jsonb,   -- [{lat, lng, radius, name}]
  active      bool not null default true,
  created_at  timestamptz not null default now()
);

-- Public read (everyone can see partner list / map pins)
alter table public.partners enable row level security;

create policy "Partners are publicly readable"
  on public.partners for select
  using (active = true);

-- =============================================================

create table public.rewards (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  title       text not null,
  description text,
  powr_cost   int not null,
  category    public.partner_category not null,
  expires_at  timestamptz,
  stock       int,    -- null = unlimited
  active      bool not null default true,
  created_at  timestamptz not null default now()
);

-- Public read for active rewards
alter table public.rewards enable row level security;

create policy "Active rewards are publicly readable"
  on public.rewards for select
  using (active = true);

-- =============================================================

create type public.redemption_status as enum ('active', 'used', 'expired');

create table public.redemptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  reward_id    uuid not null references public.rewards(id),
  code         text not null,   -- encrypted at rest via pgp_sym_encrypt
  redeemed_at  timestamptz not null default now(),
  used_at      timestamptz,
  status       public.redemption_status not null default 'active'
);

create index on public.redemptions (user_id, redeemed_at desc);

-- RLS
alter table public.redemptions enable row level security;

create policy "Users can read their own redemptions"
  on public.redemptions for select
  using (auth.uid() = user_id);

-- Inserts only via Edge Function (service role) — never direct
