-- GYM VISIT NOTIFICATION SWITCHES
--
-- A gym visit can put four notifications on a phone, and admin could only
-- switch two of them off:
--
--   check-in  "You're in at {gym}"         check_in_reminder     drawn ON THE PHONE (lib/notifications.ts)
--   points    "Session recorded 🔥"        session_completed     claim-points → send-push-notification
--   bonus     "Bonus unlocked 🔓"          session_upgraded      upgrade-gym-tier → send-push-notification
--   exit      "Session complete 💪"        gym_session_complete  gym-visit-beacon, straight to the device
--
-- The check-in banner never read notification_config, so its row's switch did
-- nothing. The exit banner had no row at all — the beacon delivers it through
-- _shared/visiblePush.ts and never passes the send-push chokepoint where the
-- kill-switch lives. Points and bonus already worked.
--
-- After this migration the beacon reads the gym_session_complete row, and the
-- app reads check_in_reminder (plus the two receipts its on-device fallbacks
-- copy) and caches it for the headless geofence task.

-- ── When did a switch last flip ──────────────────────────────────────────────
-- The exit banner is a CATCH-UP SCAN, not an event: the beacon looks every
-- minute for ended visits nobody has been told about yet (completed_push_at is
-- null, ended inside the last 2 h). Switching it off must not stamp those rows —
-- completed_push_at means "a banner was sent" to four Live Ops readers — so
-- they stay owed, and switching it back on would deliver the whole backlog at
-- once: "Session complete" for a visit someone left an hour ago. The beacon
-- uses this column to skip visits that ended before the switch came back on.
-- The admin page shows it too ("Off since 14:02"), which is what you need when
-- testing combinations.
alter table public.notification_config
  add column if not exists enabled_changed_at timestamptz;

create or replace function public.notification_config_stamp_enabled_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.enabled is distinct from old.enabled then
    new.enabled_changed_at := now();
  end if;
  return new;
end;
$$;

-- Trigger functions are only checked for EXECUTE at CREATE TRIGGER time.
revoke execute on function public.notification_config_stamp_enabled_change() from public, anon, authenticated;

drop trigger if exists trg_notification_config_enabled_change on public.notification_config;
create trigger trg_notification_config_enabled_change
  before update of enabled on public.notification_config
  for each row execute function public.notification_config_stamp_enabled_change();

-- ── The exit row ─────────────────────────────────────────────────────────────
-- Same type string the beacon already writes to push_send_log, so the log and
-- the switch line up. Receipt class: it reports a session the user just did,
-- so the shared nudge budget never applies (the beacon doesn't consult it).
insert into public.notification_config (type, category, class, description) values
  ('gym_session_complete', 'activity', 'receipt',
   'Exit: "Session complete 💪 · {gym} · N min · +X pts today", sent by the gym-visit beacon about 2 min after a credited visit ends (straight away if the bonus already landed).')
on conflict (type) do nothing;

-- The old descriptions were written before the flow settled and no longer say
-- what the user actually sees. check_in_reminder's described a nudge that
-- never shipped.
update public.notification_config set description =
  'Check-in: "You''re in at {gym}. Every minute counts." Drawn by the phone itself 75 s after a gym check-in (a drive-by that leaves sooner hears nothing). Each phone picks up this switch the next time the app is opened.'
 where type = 'check_in_reminder';

update public.notification_config set description =
  'Points: "Session recorded 🔥 · {gym} · +X pts · Day N streak", sent the moment a gym visit''s points are claimed (dwell threshold reached).'
 where type = 'session_completed';

update public.notification_config set description =
  'Bonus points: "Bonus unlocked 🔓 · {gym} · +X pts · 40-min bonus", sent when the visit reaches the upgrade threshold and the bonus lands.'
 where type = 'session_upgraded';

-- ── The app reads the switches it enforces itself ────────────────────────────
-- Same shape as the per-key system_config read policies ("Authenticated can
-- read gym dwell minutes" and friends): only the rows the client honours. The
-- check-in banner is drawn on the phone; session_completed / session_upgraded
-- have on-device fallbacks that fire when the server push could not be sent,
-- and those must not ignore a switch the admin turned off.
drop policy if exists "Authenticated can read app-honoured notification switches" on public.notification_config;
create policy "Authenticated can read app-honoured notification switches"
  on public.notification_config
  for select
  to authenticated
  using (type = any (array['check_in_reminder', 'session_completed', 'session_upgraded']));
