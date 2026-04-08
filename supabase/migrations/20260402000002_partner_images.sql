-- Add gallery image URLs to partners
alter table public.partners
  add column if not exists image1_url text,
  add column if not exists image2_url text;
