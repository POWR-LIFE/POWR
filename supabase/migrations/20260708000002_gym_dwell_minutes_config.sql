-- Admin-tunable gym dwell threshold.
--
-- The number of minutes a user must remain inside a partner gym geofence before
-- a check-in locks in the base gym point. This has historically been hardcoded
-- to 30 in three places (claim-points calcBasePoints, the client geofence dwell
-- timer, and the home progress ring). This row makes it a live setting editable
-- from admin → System Config.
--
-- claim-points (service role, bypasses RLS) reads this as the AUTHORITATIVE gate.
-- The client reads it too so the claim-firing timing + progress ring match what
-- the server actually rewards; on any read failure the client falls back to 30.
insert into public.system_config (key, value, description)
values (
  'min_gym_dwell_minutes',
  '30',
  'Minutes a user must dwell inside a partner gym geofence for a check-in to lock in the base gym point. Authoritative gate lives in claim-points; the app reads this to match its timer + progress ring.'
)
on conflict (key) do nothing;

-- system_config SELECT is otherwise admin-only. Expose just this key to
-- authenticated app users (same pattern as partner_placements_enabled) so the
-- mobile client can align its dwell timer with the server threshold.
create policy "Authenticated can read gym dwell minutes"
  on public.system_config for select
  to authenticated
  using (key = 'min_gym_dwell_minutes');

-- Remove the dead `min_session_duration_sec` row. It was seeded in an early
-- build (2026-03-27) and NO code — app or edge function — ever read it, so its
-- displayed "300" was a misleading no-op that overlapped conceptually with the
-- new (real) min_gym_dwell_minutes gate. Deleted to avoid two "minimum duration"
-- controls in admin, only one of which does anything. (Other vestigial rows —
-- geofence_radius_m, max_daily_sessions, streak_multiplier, flagged_trust_threshold,
-- base_points_per_session — are also unread but left for a separate cleanup.)
delete from public.system_config where key = 'min_session_duration_sec';
