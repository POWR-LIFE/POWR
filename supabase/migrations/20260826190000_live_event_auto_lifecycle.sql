-- =============================================================
-- Live events: automatic lifecycle (go live / lock on the clock)
-- =============================================================
-- `status` is a stored column and nothing ever moved it on its own:
-- a scheduled event with a published scoring date sat on
-- "Starts today" all week unless an admin pressed Go live, and the
-- board only ever locked when someone pressed Lock. The date IS the
-- promise, so the clock should keep it and the buttons should be the
-- override — not the mechanism.
--
-- Per-event `auto_lifecycle` (default on). A once-a-minute pg_cron job
-- flips:
--   scheduled → live    at window_start_at  (only while the window is open)
--   live      → locked  at lock_at           (when one is set)
-- Both transitions are audit-logged like the manual ones, with a null
-- admin_id and metadata.by = 'auto' so the log reads honestly.
--
-- Nothing else moves automatically: Settle and Reveal stay human
-- decisions (vetting sits between them), and draft → scheduled is the
-- admin's "make it visible" call.

alter table public.live_events
  add column if not exists auto_lifecycle boolean not null default true;

comment on column public.live_events.auto_lifecycle is
  'When true the cron flips scheduled→live at window_start_at and live→locked at lock_at. Off = admin presses the buttons.';

create or replace function public.live_event_auto_transitions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
  r   record;
begin
  -- scheduled → live: the scoring window has opened and not yet closed.
  for r in
    update public.live_events e
       set status = 'live'
     where e.auto_lifecycle
       and e.status = 'scheduled'
       and now() >= e.window_start_at
       and now() <  e.window_end_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'scheduled', 'to', 'live', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- live → locked: the lock time has passed. The app already treats the
  -- board as sealed from lock_at at read time; this moves the column so
  -- the admin panel agrees and Settle/Reveal become available.
  for r in
    update public.live_events e
       set status = 'locked'
     where e.auto_lifecycle
       and e.status = 'live'
       and e.lock_at is not null
       and now() >= e.lock_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'live', 'to', 'locked', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- Cron-only. Not callable from the app or the portal.
revoke all on function public.live_event_auto_transitions() from public, anon, authenticated;

select cron.schedule(
  'live-event-auto-transitions',
  '* * * * *',
  $$select public.live_event_auto_transitions()$$
);
