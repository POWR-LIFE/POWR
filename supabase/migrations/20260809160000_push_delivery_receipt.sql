-- Push delivery receipt + transport, 2026-08-09.
--
-- WHAT THIS FIXES
--
-- push_send_log has always been able to say "the platform took it" and never
-- "the user saw it". Its own creating migration says so, and the admin panel
-- prints the caveat. On 2026-08-09 that gap was measured for the first time: a
-- gym_session_complete push logged status 'accepted' with receipt_checked_at
-- stamped 3.15 s after send, and reached the tray about 25 minutes later.
--
-- receipt_checked_at cannot ever catch that. Expo's docs are explicit that a
-- receipt of 'ok' means "the Android (FCM) or iOS (APNs) push notification
-- service successfully received the notification" — the hand-off, not the
-- delivery. And it was never read anyway: before this migration the column was
-- written in exactly one file and read in exactly one place, a "pending" chip
-- in the admin panel. No cron, no alert, no query.
--
-- delivered_at is a different kind of fact. It is written BY THE DEVICE, from
-- the code path that actually presented the notification.
--
-- ⚠ READ THIS BEFORE BUILDING ON IT: delivered_at is proof in one direction
-- only. Non-null means the banner was displayed on that device, which is
-- something this system has never been able to assert. NULL means nothing at
-- all — the stamp is fire-and-forget from a background context that may be
-- mid-Doze with no usable session, and losing it is expected and harmless. Do
-- not gate a re-send on it. gym-visit-beacon's ANNOUNCE pass was deleted on
-- 2026-08-07 for exactly that mistake: a server fallback whose de-dupe depended
-- on a client mark landing, which duplicated the banner on precisely the
-- headless case it was built to rescue.

alter table public.push_send_log
  add column if not exists delivered_at timestamptz,
  add column if not exists transport    text;

comment on column public.push_send_log.delivered_at is
  'Set by the DEVICE when it presented the notification. Non-null proves display; NULL proves nothing (the stamp is best-effort from a background context). Never gate a re-send on this.';

comment on column public.push_send_log.transport is
  'How the message was submitted: expo | fcm_direct | apns_direct. Previously only inferable from the shape of ticket_id.';

-- Finds sends still unconfirmed by the device — the query the 08-09 incident
-- had no way to ask. Partial so it stays small: confirmed rows drop straight out.
create index if not exists push_send_log_undelivered_idx
  on public.push_send_log (created_at desc)
  where delivered_at is null and status = 'accepted';

-- Stamp a send as displayed.
--
-- Callable WITHOUT a session, on purpose. The caller is a headless Android
-- notification task that has just been woken mid-Doze, where every path through
-- the auth machinery is a known freeze risk (see lib/gymVisits.ts's nonce path
-- and the 2026-08-03 wake deadlock). The same reasoning that put the wake RPCs
-- on an anon-key raw fetch applies here, and this one is weaker still: it takes
-- an unguessable id, returns nothing, and writes a timestamp.
--
-- It is NOT a point, and must never grow into one — the device_wake_ticket rule
-- ("five verbs, NEVER a point") is the boundary this stays behind. The worst an
-- attacker with a guessed uuid can do is assert that a notification they were
-- already sent was displayed.
--
-- Idempotent: the first stamp wins, so a re-presented notification cannot move
-- the recorded delivery time later.
create or replace function public.mark_push_displayed(p_log_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_send_log
     set delivered_at = now()
   where id = p_log_id
     and delivered_at is null;
$$;

revoke all on function public.mark_push_displayed(uuid) from public;
grant execute on function public.mark_push_displayed(uuid) to anon, authenticated;

-- Transport switch for user-facing pushes.
--
-- ⚠ SEEDED OFF, AND THE ORDER MATTERS. On 'fcm_direct' the server stops asking
-- Expo to render Android banners and submits them itself, data-only — which
-- means the CLIENT draws them. A device whose bundle predates lib/displayPush.ts
-- receives that push, fails extractData's type guard, and shows NOTHING. Flipping
-- this before the OTA has landed would take Android from "the banner is late" to
-- "there is no banner", for everyone, at once.
--
--   1. deploy the edge functions (inert: this key still says 'expo')
--   2. publish the OTA, and confirm it reached devices
--   3. update system_config set value = 'fcm_direct' where key = 'visible_push_transport'
--   4. watch push_send_log: transport = 'fcm_direct' rows should acquire a
--      delivered_at within seconds. If they do not, set it back to 'expo' —
--      rollback is that one statement, with no deploy.
insert into public.system_config (key, value, description)
values (
  'visible_push_transport',
  'expo',
  'How user-facing pushes reach ANDROID: expo = via Expo''s push service (legacy), fcm_direct = submitted straight to FCM v1 data-only at HIGH priority and rendered by the client. iOS is unaffected either way. ⚠ fcm_direct REQUIRES a bundle containing lib/displayPush.ts — flip it only after that OTA has landed. Anything unrecognised falls back to expo.'
)
on conflict (key) do nothing;
