-- Terra pause switch.
--
-- Garmin stopped delivering through Terra on 2026-09-21 (Garmin now approves
-- each app itself and has paused approvals). Until that's fixed, Terra is
-- paused and every wearable syncs through the phone's own health store.
--
-- 'terra_paused' = 'true' stands Terra down without disconnecting anyone:
--   - the app treats every Terra brand as "read from Apple Health / Health
--     Connect instead" and routes its connect tile to the phone instead,
--     without touching anyone's profile (lib/health/terraPause.ts),
--   - terra-auth refuses new connections, terra-webhook ignores data, and
--     terra-poll skips its cycle (supabase/functions/_shared/terraPause.ts).
-- Back to 'false' restores everything not yet disconnected. Disconnecting for
-- good is a separate, one-way step: the terra-deauth-all function.
--
-- Default OFF — shipping this changes nothing until an admin flips it.

insert into public.system_config (key, value, description)
values (
  'terra_paused',
  'false',
  'When true, Terra is paused: every wearable syncs through Apple Health / Health Connect, Terra connect buttons route to the phone, and Terra data is ignored. Back to false restores Terra for anyone not yet disconnected.'
)
on conflict (key) do nothing;

-- system_config SELECT is otherwise admin-only. The app must be able to read
-- this one key — location_close_mode once sat 'on' in this table while every
-- phone stayed on its default because no policy let them read it.
drop policy if exists "Authenticated can read terra pause" on public.system_config;
create policy "Authenticated can read terra pause"
  on public.system_config for select
  to authenticated
  using (key = 'terra_paused');
