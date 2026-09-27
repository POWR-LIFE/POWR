-- The gym's Monday recap, switched on. Runs after the member weekly (08:00)
-- and the brand digest (09:00) so the three never share a Mailgun window.
-- Applied only once the sample email has been seen and approved.

do $job$
begin
  perform cron.unschedule('gym-weekly-recap-email');
exception when others then
  null;
end
$job$;

select cron.schedule(
  'gym-weekly-recap-email',
  '0 10 * * 1',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-gym-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{"kind":"weekly_recap"}'::jsonb
  )
  $cron$
);
