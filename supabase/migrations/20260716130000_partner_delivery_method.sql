-- Which of the three integration paths a brand delivers codes through:
-- 'api' | 'shopify' | 'manual'. NULL = not chosen yet — the portal shows the
-- first-run chooser until the brand picks (or we infer it for brands that
-- integrated before the chooser existed; see manage-partner-api
-- resolve_delivery_method).
alter table public.reward_brand_integrations
  add column if not exists delivery_method text
    check (delivery_method in ('api', 'shopify', 'manual')),
  add column if not exists delivery_method_set_at timestamptz;
