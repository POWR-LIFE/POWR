-- Add hero image snapshot to redemptions so the wallet card can show a cover image.
alter table public.redemptions
  add column if not exists reward_hero_image_url text;

-- Backfill from current catalogue for any existing redemptions.
update public.redemptions r
   set reward_hero_image_url = rw.hero_image_url
  from public.rewards rw
 where rw.id = r.reward_id
   and r.reward_hero_image_url is null
   and rw.hero_image_url is not null;
