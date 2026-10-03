-- =============================================================
-- profiles.language — the person's preferred language, read, never asked
-- =============================================================
-- The reward and gym portals read it from the signed-in user's browser
-- (landing-page/src/lib/locale.js → rememberProfileLanguage) and keep it
-- current here, so anything addressed to that person — the Monday gym recap,
-- the brand weekly report — can be sent in their language once a translation
-- exists. It stores the PREFERENCE ("es"), not what the portal is currently
-- able to show, so emails can follow as soon as Spanish is ready.
--
-- ISO 639 language only ("en", "es", "pt") — never a full locale. profiles is
-- world-readable; a language code is coarser than the country_code already on
-- it and identifies nobody. NULL = we haven't seen this person on a portal yet
-- (or on any surface that reports it); treat as English.
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
  'Preferred language (ISO 639, lower-case), read from the user''s browser by the reward/gym portals. NULL = unknown, treat as English. Never a full locale.';
