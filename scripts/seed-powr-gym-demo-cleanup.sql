-- Removes everything scripts/seed-powr-gym-demo.py made: the tagged accounts
-- and, through their foreign keys, their profiles, sessions, Share-with-POWR
-- switches, reach-outs, nudges and drift episodes.
--   supabase db query --linked -f scripts/seed-powr-gym-demo-cleanup.sql
-- Runs with triggers ON (cascades need them). Nothing here notifies anyone:
-- the Slack ping fires on profile INSERT only.

begin;

-- Rows that point at the seeded people but don't cascade from auth.users.
delete from public.gym_member_outreach o using auth.users u
 where u.id = o.user_id and u.raw_app_meta_data->>'seed' = 'powr-gym-demo';
delete from public.gym_quiet_nudges n using auth.users u
 where u.id = n.user_id and u.raw_app_meta_data->>'seed' = 'powr-gym-demo';
delete from public.gym_drift_alerts a using auth.users u
 where u.id = a.user_id and u.raw_app_meta_data->>'seed' = 'powr-gym-demo';
delete from public.gym_activity_consents c using auth.users u
 where u.id = c.user_id and u.raw_app_meta_data->>'seed' = 'powr-gym-demo';
delete from public.activity_sessions s using auth.users u
 where u.id = s.user_id and u.raw_app_meta_data->>'seed' = 'powr-gym-demo';

delete from auth.users where raw_app_meta_data->>'seed' = 'powr-gym-demo';

commit;
