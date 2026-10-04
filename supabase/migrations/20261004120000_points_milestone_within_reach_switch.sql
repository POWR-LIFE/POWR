-- THE "REWARD WITHIN REACH" SWITCH
--
-- The only thing the points_milestone row controls is the "Reward within
-- reach" banner, and until now it controlled nothing at all. Nothing on the
-- server sends a points_milestone push; the phone schedules the banner itself
-- (lib/notifications.ts scheduleRewardWithinReach) about 2.5 h after a gym
-- visit's points are claimed, from the within_reach that claim-points returns.
-- A phone-scheduled banner never passes send-push, where the kill-switch
-- lives, so switching this row off left the banner going out.
--
-- claim-points now reads this row and returns no within_reach while it is off
-- (which also cancels a banner the phone already has queued). The admin page
-- shows it in the Gym visit section, since only a gym claim schedules it.
update public.notification_config set description =
  'Reward within reach: "You''re close. N pts to unlock your {reward} reward." Drawn by the phone about 2.5 h after a gym visit''s points are claimed (08:00–21:00, once a day at most), when they are within 85% of a reward. claim-points reads this switch at claim time.'
 where type = 'points_milestone';
