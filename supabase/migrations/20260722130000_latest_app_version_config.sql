-- Admin-published "latest store version" per platform.
--
-- The app compares its running binary version against these at launch and
-- shows a dismissible update banner on Home (plus a Check-for-updates row in
-- Settings) that deep-links to the store. Bumped by hand from admin → System
-- Config → App Release when a release actually goes live on its store — a
-- config row is deterministic, can deliberately lag a phased rollout, and
-- avoids querying the stores from the client.
--
-- Same values double as the number to type into a Broadcast "below version"
-- audience when nudging laggards by push.
insert into public.system_config (key, value, description)
values
  (
    'latest_ios_version',
    '1.4.11',
    'Newest POWR version live on the App Store (x.y.z). Devices running an older version see the in-app update banner. Bump when an iOS release is approved and live.'
  ),
  (
    'latest_android_version',
    '1.4.11',
    'Newest POWR version live on Google Play (x.y.z). Devices running an older version see the in-app update banner. Bump when an Android release is fully rolled out.'
  )
on conflict (key) do nothing;

-- system_config SELECT is otherwise admin-only; expose just these two keys to
-- signed-in app users (same pattern as min_gym_dwell_minutes).
create policy "Authenticated can read latest app versions"
  on public.system_config for select
  to authenticated
  using (key in ('latest_ios_version', 'latest_android_version'));
