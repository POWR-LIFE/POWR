-- Add opening_hours to partners table
-- Format: {"mon":{"open":"06:00","close":"22:00"}, ..., "sun":{"open":"09:00","close":"18:00"}}
-- A null value for a day means the partner is closed that day.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS opening_hours jsonb,
  ADD COLUMN IF NOT EXISTS description   text;

COMMENT ON COLUMN public.partners.opening_hours IS
  'Per-day hours. Keys: mon,tue,wed,thu,fri,sat,sun. Values: {open:"HH:MM",close:"HH:MM"} or null for closed.';
