-- profiles.activity_selections has been LIVE in prod since 2026-07-31 (applied
-- via MCP, never committed) — this file records it so a fresh environment
-- matches. Idempotent.
--
-- Array of {slug, label, bucket} — the user's concrete catalog picks (Padel,
-- Boxing, Gym…). activity_preferences stays the derived scoring buckets that
-- every legacy consumer reads. NULL = legacy bucket-only user.
--
-- Note the activity_preferences column default still says {gym,running,walking}:
-- that is only what a profile carries between sign-up and the onboarding
-- activities step (which always overwrites it). Since 2026-08-28 gym is an
-- ordinary pick — the client no longer force-prepends it on save.
alter table public.profiles
    add column if not exists activity_selections jsonb;

comment on column public.profiles.activity_selections is
    'Concrete activity picks [{slug,label,bucket}] from constants/activityCatalog.ts; null = legacy bucket-only user. activity_preferences holds the derived buckets.';
