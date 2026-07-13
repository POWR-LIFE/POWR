-- Per-send push delivery log. Written by the edge push path (expoPush.ts +
-- send-push-notification) so an individual user's push history — including the
-- exact gate or Expo/APNs/FCM error that stopped one — survives past the 24h
-- edge-log window and is inspectable from the admin panel.
--
-- Status vocabulary:
--   skipped  — a server gate stopped the send (skip_reason says which)
--   failed   — Expo rejected the message at the ticket step (error says why)
--   queued   — Expo accepted; receipt confirmation pending
--   accepted — delivery receipt ok: APNs/FCM accepted the push
--   rejected — delivery receipt error (error carries the code, e.g. DeviceNotRegistered)
--
-- NOTE: 'accepted' proves hand-off to the platform push service, not that the
-- device displayed it — that boundary is exactly the open iOS incident.

create table public.push_send_log (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  type               text not null,
  title              text,
  body               text,
  expo_push_token    text,
  status             text not null check (status in ('skipped','failed','queued','accepted','rejected')),
  skip_reason        text,
  ticket_id          text,
  error              text,
  receipt_checked_at timestamptz,
  created_at         timestamptz not null default now()
);

create index push_send_log_user_created_idx on public.push_send_log (user_id, created_at desc);
create index push_send_log_ticket_idx on public.push_send_log (ticket_id) where ticket_id is not null;

alter table public.push_send_log enable row level security;

-- Writes come exclusively from service-role edge functions (bypass RLS); the
-- only client access is admin read in the panel.
create policy "Admins can read push send log"
  on public.push_send_log for select
  using (exists (select 1 from admin_roles where admin_roles.user_id = auth.uid()));

-- Logs are for triage, not history: keep 30 days.
select cron.schedule(
  'purge-push-send-log',
  '10 4 * * *',
  $$delete from public.push_send_log where created_at < now() - interval '30 days'$$
);
