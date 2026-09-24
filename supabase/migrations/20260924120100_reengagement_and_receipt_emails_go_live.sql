-- Switches on the re-engagement + redemption-receipt emails built in
-- 20260924120000. Apply only once the previews are approved.

-- ── Receipt: every new redemption → send-redemption-receipt ─────────────────
-- AFTER INSERT on redemptions covers every redeem path (unique code, shared
-- promo code, affiliate link). Reusing an existing affiliate redemption inserts
-- nothing, so it can't double-send; the function also claims receipt_emailed_at.

create or replace function public.notify_redemption_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'shared_resolve_token';

  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-redemption-receipt',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', coalesce(v_token, '')
    ),
    body := jsonb_build_object('redemption_id', new.id)
  );
  return new;
exception when others then
  -- Never let email plumbing break a redemption.
  return new;
end;
$$;

drop trigger if exists redemption_receipt_email on public.redemptions;
create trigger redemption_receipt_email
  after insert on public.redemptions
  for each row
  execute function public.notify_redemption_receipt();

-- ── Re-engagement: daily 09:00 UTC (10:00 UK summer time) ───────────────────

select cron.unschedule('reengagement-email')
where exists (select 1 from cron.job where jobname = 'reengagement-email');

select cron.schedule(
  'reengagement-email',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-reengagement-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
