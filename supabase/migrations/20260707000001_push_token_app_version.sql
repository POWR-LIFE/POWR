-- App-version telemetry on push tokens.
--
-- The client reports its binary version alongside the push-token upsert that
-- already runs on every app launch, so user_push_tokens.updated_at doubles as
-- "last seen on this version". NULL app_version means the row was last written
-- by a build older than this change — which is itself the signal the admin
-- panel uses to spot users stuck on old builds.

alter table public.user_push_tokens
  add column if not exists app_version text,
  add column if not exists app_build   text;

comment on column public.user_push_tokens.app_version is
  'Client binary version (CFBundleShortVersionString / versionName) reported at token upsert; "x.y.z (Expo Go)" for dev clients; NULL = pre-telemetry build.';
comment on column public.user_push_tokens.app_build is
  'Client build number (CFBundleVersion / versionCode) reported at token upsert.';

-- Admin panel reads tokens (platform/version/updated_at) on the user profile.
-- Mirrors the existing "Admins can read all ..." policies: inline admin_roles
-- EXISTS (not is_admin()) per the 0028/0029 lockdown convention; anon has no
-- auth.uid() so it fails closed.
create policy "Admins can read all push tokens"
  on public.user_push_tokens for select
  using (exists (select 1 from admin_roles where admin_roles.user_id = auth.uid()));
