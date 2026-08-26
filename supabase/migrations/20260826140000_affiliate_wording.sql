-- "Affiliate" is the user-facing name from 2026-08-26 (Jamie: "creator" reads as
-- content-making). Tables, RPCs, triggers and edge functions keep their
-- creator_* identifiers — this only touches the admin-visible descriptions.
-- The rewards enum integration_type='AFFILIATE' (outbound brand checkout links)
-- is unrelated and untouched.

update public.system_config set description =
  'Master switch for the affiliate programme. Off: affiliate codes act as plain member invites, /join links go to the app with no attribution, the /affiliate portal is closed to non-admins, no event bonuses. Admin setup pages keep working.'
where key = 'creator_program_enabled';

update public.system_config set description =
  'Earned affiliate invite: converted referrals (verified first workouts, counted as referrer) a member needs before Home asks whether they want to become an affiliate. 0 turns the prompt off.'
where key = 'creator_invite_threshold';

update public.system_config set description =
  'Earned affiliate invite: only conversions inside this many days count towards the threshold. 0 = all time.'
where key = 'creator_invite_window_days';

update public.notification_config set description =
  'Sent once when a member''s converted referrals cross the affiliate-invite threshold — invites them to ask to join the affiliate programme'
where type = 'creator_invite_eligible';

update public.notification_config set description =
  'Sent when an admin approves a member''s affiliate programme request — their portal is ready'
where type = 'creator_invite_approved';
