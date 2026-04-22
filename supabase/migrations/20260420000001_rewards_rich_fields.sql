-- Add rich display fields to rewards (offer copy, hero image, brand colour, URL, partner blurb).

alter table public.rewards
  add column if not exists offer text,
  add column if not exists hero_image_url text,
  add column if not exists brand_color text,
  add column if not exists url text,
  add column if not exists partner_blurb text;
