-- The morning "someone started drifting" email to gym teams, switched on.
-- 07:30 UTC every day (08:30 in the UK summer, 07:30 in winter), clear of the
-- Monday member weekly (08:00), brand digest (09:00) and gym recap (10:00).
-- A real run opens and closes the drift episodes (get_gym_drift_digests
-- with p_commit), so each person is emailed about once per episode.
-- Apply only once a sample (send-gym-email { kind: "drift_digest",
-- sample: true, only_email }) has been seen and approved.

do $job$
begin
  perform cron.unschedule('gym-drift-digest-email');
exception when others then
  null;
end
$job$;

select cron.schedule(
  'gym-drift-digest-email',
  '30 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-gym-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{"kind":"drift_digest"}'::jsonb
  )
  $cron$
);
