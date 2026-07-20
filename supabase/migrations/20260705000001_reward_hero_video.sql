-- Reward cards can carry an optional looping background video that plays in
-- place of the hero image. The hero image stays as the poster / still frame:
-- it paints instantly, backs the shareable RewardShareCard (which captures a
-- static image), and is the fallback when a device has Reduce Motion enabled.
--
-- Video-first at render time: wherever a reward surfaces a hero, if
-- hero_video_url is set the client plays the video and treats hero_image_url as
-- the poster underneath it.
--
-- Videos live in the existing public `reward-images` bucket (no MIME restriction),
-- uploaded via the same admin/partner flow as hero images.

alter table public.rewards
  add column if not exists hero_video_url text;

comment on column public.rewards.hero_video_url is
  'Optional looping background video for the reward card. When set, clients play it over hero_image_url (used as the poster / share-card still / reduce-motion fallback).';

-- Mirror the field on partner submissions so a partner can supply the video via
-- the self-serve intake; the admin approval flow copies it onto the live reward.
alter table public.reward_submissions
  add column if not exists hero_video_url text;

comment on column public.reward_submissions.hero_video_url is
  'Optional partner-supplied looping hero video; copied to rewards.hero_video_url on approval.';
