-- Seed a second Tribe reward using the shared brand copy.
-- This uses a placeholder promo code that can be amended later in admin.

insert into public.rewards (
  partner_id,
  title,
  description,
  powr_cost,
  category,
  integration_type,
  active,
  value_label,
  offer,
  hero_image_url,
  brand_color,
  url,
  partner_blurb,
  promo_code,
  discount_type,
  discount_value
)
select
  p.id,
  '35% off site wide',
  'Site-wide discount',
  100,
  'nutrition',
  'POOL',
  true,
  '35% OFF',
  'Get 35% off site wide across Tribe''s range of natural, plant-based performance nutrition.',
  'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/tribe-main.webp',
  '#1877C7',
  'https://wearetribe.co/',
  'Tribe makes natural, plant-based protein bars and shakes, built for real performance. Founded by ultra-runners, made in the UK.',
  'POWR-TRIBE-SITE35',
  'percentage',
  35
from public.partners p
where p.partner_code = 'TRIB'
  and not exists (
    select 1
    from public.rewards r
    where r.partner_id = p.id
      and r.title = '35% off site wide'
  );