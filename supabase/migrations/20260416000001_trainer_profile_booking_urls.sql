-- =============================================================
-- TRAINER PROFILE + BOOKING URLS
-- =============================================================
-- Add optional external links for a trainer's profile page on the
-- partner's website and a booking/scheduling URL. Both render in
-- the expanded trainer card on the Discover screen.

alter table public.trainers
  add column if not exists profile_url text,
  add column if not exists booking_url text;
