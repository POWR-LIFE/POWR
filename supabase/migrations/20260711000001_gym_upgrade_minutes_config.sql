-- Admin-tunable gym upgrade (bonus) tier threshold.
--
-- Companion to min_gym_dwell_minutes (20260708000002): the number of minutes a
-- gym session must reach to unlock the upgrade tier (20 base pts vs 15).
-- Historically hardcoded to 40 in claim-points, upgrade-gym-tier, the client
-- geofence upgrade timer, the home card "stay 40m to unlock" copy and the
-- session_upgraded push. This row makes it a live setting editable from
-- admin → System Config so both gym timers can be tuned together.
--
-- Setting it at or below min_gym_dwell_minutes is allowed and simply collapses
-- the tiers: any qualifying session earns the upgrade tier immediately.
insert into public.system_config (key, value, description)
values (
  'gym_upgrade_minutes',
  '40',
  'Minutes a gym session must reach to unlock the upgrade tier (20 base pts vs 15). Authoritative gate lives in claim-points/upgrade-gym-tier; the app reads this to match its timer and "stay Xm to unlock" messaging.'
)
on conflict (key) do nothing;

-- Same authenticated-read exposure pattern as min_gym_dwell_minutes so the
-- mobile client can align its upgrade timer + copy with the server threshold.
create policy "Authenticated can read gym upgrade minutes"
  on public.system_config for select
  to authenticated
  using (key = 'gym_upgrade_minutes');
