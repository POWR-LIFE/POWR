-- =============================================================
-- SHOPIFY CONNECTOR
-- POWR acting as the partner's integration engineer, riding the partner
-- developer API primitives: a brand connects their Shopify store via OAuth;
-- codes are minted straight into Shopify at redemption time (the brand's
-- JIT mint_url points at OUR shopify-connect/mint adapter), and orders/create
-- webhooks auto-reconcile usage. Zero partner engineering.
-- =============================================================

-- One store per brand. Holds the offline Admin API token — service-role only
-- (no RLS policies); the portal reads connection state via the
-- shopify-connect fn's status action, never this table.
create table if not exists public.reward_brand_shopify (
  brand_name    text primary key,
  shop_domain   text,
  access_token  text,
  scopes        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'connected', 'uninstalled', 'disconnected')),
  state_token   text,           -- OAuth CSRF state, one pending attempt at a time
  state_expires timestamptz,
  connected_at  timestamptz,
  uninstalled_at timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- brand_name matching is case-insensitive everywhere else.
create unique index if not exists idx_brand_shopify_lower
  on public.reward_brand_shopify (lower(brand_name));

-- A connected shop must map to exactly one brand (webhooks arrive keyed by
-- shop domain only).
create unique index if not exists idx_brand_shopify_domain
  on public.reward_brand_shopify (lower(shop_domain))
  where shop_domain is not null and status = 'connected';

alter table public.reward_brand_shopify enable row level security;
-- Service-role only: the access token lives here.

-- Which Shopify discount each reward mints from, plus the normalized discount
-- config captured at mapping time (so mints don't re-read Shopify).
create table if not exists public.reward_shopify_discounts (
  reward_id      uuid primary key references public.rewards(id) on delete cascade,
  brand_name     text not null,
  discount_gid   text not null,   -- gid://shopify/DiscountCodeNode/…
  discount_title text not null,
  config         jsonb not null,  -- { kind: percentage|amount, value, applies, … }
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_reward_shopify_discounts_brand
  on public.reward_shopify_discounts (lower(brand_name));

alter table public.reward_shopify_discounts enable row level security;

create policy "Brand users read own shopify mappings"
  on public.reward_shopify_discounts for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = (select auth.uid())
        and lower(u.brand_name) = lower(reward_shopify_discounts.brand_name)
    )
  );

create policy "Admins read all shopify mappings"
  on public.reward_shopify_discounts for select
  to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));
