-- Insert Tribe as a partner and reward into the database,
-- removing the need for the hardcoded entry in rewards.tsx.

-- 1. Add shared/static promo_code field to rewards (for codes everyone sees).
alter table public.rewards
  add column if not exists promo_code text;

-- 2. Insert Tribe as a partner.
insert into public.partners (name, logo_url, category, partner_code, roles, active)
values (
  'Tribe',
  null,           -- logo_url updated after image upload
  'nutrition',
  'TRIB',
  array['reward_provider'],
  true
)
on conflict do nothing;

-- 3. Insert Tribe reward.
insert into public.rewards (
  partner_id, title, description, powr_cost, category,
  integration_type, active, value_label, offer, hero_image_url,
  brand_color, url, partner_blurb, promo_code
)
select
  p.id,
  'Trial pack · 6 best sellers',
  'Plant-based protein bars',
  10,
  'nutrition',
  'POOL',
  true,
  '£12.99 value',
  'Redeem a 6-pack Trial Pack of Tribe''s best-selling plant-based protein bars — free with your POWR points.',
  null,           -- hero_image_url updated after image upload
  '#1877C7',
  'https://wearetribe.co/products/trial-pack-6-x-best-sellers',
  'Tribe makes natural, plant-based protein bars and shakes, built for real performance. Founded by ultra-runners, made in the UK.',
  'POWR-TRIBE-6PKSJ4'
from public.partners p
where p.partner_code = 'TRIB'
  and not exists (
    select 1 from public.rewards r
     where r.partner_id = p.id
       and r.title = 'Trial pack · 6 best sellers'
  );
