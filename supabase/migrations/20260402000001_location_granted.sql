-- Add location_granted flag to profiles
-- Tracks whether the user granted location permission during onboarding

alter table public.profiles
  add column location_granted boolean not null default false;
