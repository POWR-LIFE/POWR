-- =============================================================
-- Live events: a visible push when the results are revealed
-- =============================================================
-- The Realtime signal (20260826210000) turns over the phones that are
-- open. This is for the ones that aren't: every registrant gets one
-- push the moment the admin presses Reveal, personal where the frozen
-- results allow it (final rank + prize), routing to the League tab.
--
-- Receipt class, no user toggle — you registered for the event, its
-- result is not a nudge to opt out of. Admin kill-switch in
-- notification_config as usual. Once per reveal: the trigger only
-- fires on the transition INTO 'revealed' (a Re-settle while locked
-- does not re-send; Reveal is frozen after the first time anyway).
--
-- Same transport as every other DB-fired push: pg_net POST to
-- send-push-notification with the Vault shared token. One request per
-- registrant — pg_net is asynchronous, so a big roster does not slow
-- the admin's click; send-push owns every per-user gate (tokens,
-- admin kill-switch, send log).

insert into public.notification_config (type, category, description, class, daily_cap) values
  ('event_results_revealed', 'social',
   'Sent to every registrant of a live event the moment the admin reveals the results — carries their final rank and prize where they have one, and opens the League tab', 'receipt', null)
on conflict (type) do nothing;

create or replace function public.notify_live_event_revealed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'shared_resolve_token';

  for r in
    select lp.user_id,
           res.rank,
           res.prize_label
      from public.live_event_participants lp
      left join public.live_event_results res
             on res.event_id = lp.event_id and res.user_id = lp.user_id
     where lp.event_id = new.id
       and lp.disqualified_at is null
  loop
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-resolve-token', v_token
      ),
      body := jsonb_build_object(
        'target_user_id', r.user_id,
        'type', 'event_results_revealed',
        'payload', jsonb_build_object(
          'event_id',    new.id,
          'event_name',  new.name,
          'rank',        r.rank,
          'prize_label', r.prize_label
        )
      ),
      timeout_milliseconds := 5000
    );
  end loop;
  return new;
exception when others then
  raise warning '[notify_live_event_revealed] %: %', new.slug, sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_live_event_revealed() from public, anon, authenticated;

drop trigger if exists trg_notify_live_event_revealed on public.live_events;
create trigger trg_notify_live_event_revealed
  after update of status on public.live_events
  for each row
  when (new.status = 'revealed' and old.status is distinct from 'revealed')
  execute function public.notify_live_event_revealed();
