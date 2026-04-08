-- =============================================================
-- Activity preferences: persist user's chosen activities in DB
-- =============================================================

-- Add a text[] column with a sensible default (gym + running + walking)
alter table public.profiles
  add column activity_preferences text[] not null default '{gym,running,walking}';

-- Backfill existing users from auth metadata if they already chose
update public.profiles p
set activity_preferences = (
  select array_agg(elem)
  from auth.users u,
       lateral jsonb_array_elements_text(u.raw_user_meta_data -> 'activity_preferences') as elem
  where u.id = p.id
    and u.raw_user_meta_data ? 'activity_preferences'
)
where exists (
  select 1 from auth.users u
  where u.id = p.id
    and u.raw_user_meta_data ? 'activity_preferences'
);
