-- =============================================================
-- profiles.language — the language a person reads, read, never asked
-- =============================================================
-- ALREADY LIVE: this column and constraint were applied to production on
-- 2026-10-03 from the portal-language branch (#513), which never reached main,
-- so the migration was never recorded. This file brings it to main under a
-- current version; every statement is idempotent, so applying it changes
-- nothing on prod beyond the column comment.
--
-- Written by the app (lib/i18n/reportLanguage.ts — the member's pick in
-- Settings › Language, else the phone's language) and, once #513 lands, the
-- reward and gym portals (the browser's). It stores the PREFERENCE ("fr"), not
-- what a surface can show today, so pushes and emails can follow as soon as a
-- translation exists — and so we can count who is waiting for one.
--
-- ISO 639 language only ("en", "es", "pt") — never a full locale. profiles is
-- world-readable; a language code is coarser than the country_code already on
-- it and identifies nobody. NULL = never reported; treat as English.
--
-- No new grant: authenticated already holds table-level UPDATE on profiles and
-- profiles_update limits it to the user's own row.

alter table public.profiles add column if not exists language text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_language_iso639'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_language_iso639
      check (language is null or language ~ '^[a-z]{2,3}$');
  end if;
end $$;

comment on column public.profiles.language is
  'Language the person reads (ISO 639, lower-case): their in-app pick, else their phone or browser language. Reported by the app and portals; may be a language POWR cannot show yet. NULL = unknown, treat as English. Never a full locale.';
