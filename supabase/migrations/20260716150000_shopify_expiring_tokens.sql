-- Shopify now rejects non-expiring Admin API tokens for public apps created
-- after 2026-04-01 (ours became public 2026-07-16 when distribution was set).
-- Exchanges request `expiring=1`: access tokens live 1h, refresh tokens 90d
-- and ROTATE on every refresh — both sides tracked here so shopify-connect
-- can refresh ahead of expiry (see ensureFreshToken).
alter table public.reward_brand_shopify
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists refresh_token text,
  add column if not exists refresh_token_expires_at timestamptz;
