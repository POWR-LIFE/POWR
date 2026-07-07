-- OTA-update identity alongside the app-version telemetry.
--
-- Once EAS Update ships, the binary version stops identifying the code a
-- device runs — two phones on the same build can run different JS. These
-- columns pin down the exact update: NULL ota_update_id = the binary's
-- embedded bundle (or a pre-OTA build), an id = that EAS Update.

alter table public.user_push_tokens
  add column if not exists ota_update_id text,
  add column if not exists ota_channel   text;

comment on column public.user_push_tokens.ota_update_id is
  'EAS Update id of the running JS bundle when it is an OTA update; NULL = embedded bundle / pre-OTA build.';
comment on column public.user_push_tokens.ota_channel is
  'EAS Update channel the binary is subscribed to (preview/production); NULL = pre-OTA build or Expo Go.';
