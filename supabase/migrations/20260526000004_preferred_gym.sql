-- =============================================================
-- PREFERRED GYM
-- Allows users to mark one partner gym as their home/preferred gym
-- =============================================================

alter table public.profiles
  add column preferred_gym_id uuid references public.partners(id) on delete set null;

comment on column public.profiles.preferred_gym_id
  is 'The user''s preferred/home gym partner. Nullable. FK to partners, clears on partner deletion.';
