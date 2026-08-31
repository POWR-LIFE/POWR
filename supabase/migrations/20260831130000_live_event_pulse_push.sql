-- =============================================================
-- Live events: placement + referral-gate pulse pushes, per-event controls
--
-- Jamie (08-31): "we don't have any placement notifications or referral
-- notifications, so to let users know what position they are in for the
-- day, or what referrals they have left. Can we add this in and have
-- controls for it."
--
-- This lives on the EVENT, not in Broadcast: a broadcast is one identical
-- message for the whole audience, while these carry each registrant's own
-- numbers — their rank, their signup count. Same transport as the reveal
-- push (20260826220000): one pg_net POST per registrant to
-- send-push-notification with the Vault shared token; send-push owns every
-- per-user gate (tokens, admin kill-switch, daily cap, send log).
--
-- Two kinds:
--   rank — "you're #4 today": rank, points, ▲/▼ since the scoring day
--          began (the SAME reference the board arrows use — push and app
--          can never disagree), and the gap to the row above. Only while
--          the board is actually showing (live, window open, not hidden,
--          not past lock) — a rank push from a sealed board would leak
--          exactly what the seal hides.
--   gate — "1 more signup to go": sent only to registrants still short of
--          the entry gate while the gate deadline is ahead. Not
--          score-shaped, so it may run while the board is hidden, and
--          keeps running through 'locked' — FNL's gate deadline (doors,
--          Fri 18:00) is AFTER lock (Thu 23:00) by design.
--
-- Controls (admin /admin/events, per event):
--   live_events.notify_rank_at / notify_gate_at — time of day, read on the
--   EVENT's clock (Europe/London — the venue's clock, same one the scoring
--   window was pinned to). Null = off, the default: no existing event
--   changes behaviour. A 5-minute pg_cron fires each at most once per
--   London day; "Send now" buttons call admin_send_event_pulse (dry-run
--   first so the admin sees the recipient count before confirming).
-- =============================================================

-- ── 1. Schedule columns ─────────────────────────────────────────────────────

alter table public.live_events
  add column if not exists notify_rank_at time,
  add column if not exists notify_gate_at time;

comment on column public.live_events.notify_rank_at is
  'Daily send time (Europe/London) for the per-registrant placement push; null = off. Fired once per London day by live_event_notification_dispatch().';
comment on column public.live_events.notify_gate_at is
  'Daily send time (Europe/London) for the referral-gate reminder push; null = off. Only registrants short of the gate get it, only while the gate deadline is ahead.';

-- ── 2. Send log — idempotency for the cron, history for the panel ───────────

create table if not exists public.live_event_pulse_sends (
  id         uuid        primary key default gen_random_uuid(),
  event_id   uuid        not null references public.live_events(id) on delete cascade,
  kind       text        not null check (kind in ('rank', 'gate')),
  day        date        not null,   -- London date the send belongs to
  source     text        not null check (source in ('auto', 'manual')),
  recipients integer     not null,
  created_at timestamptz not null default now()
);

comment on table public.live_event_pulse_sends is
  'One row per pulse-push send (auto = the daily cron, manual = an admin Send now). The partial unique index is the cron''s claim: at most one auto send per event, kind and London day, however many cron ticks race.';

-- The claim: overlapping cron ticks insert-or-nothing on this, and only
-- the tick that actually inserted sends (same pattern as
-- scheduled_broadcast_dispatches). Manual sends are deliberately outside
-- it — "Send now" always sends.
create unique index if not exists live_event_pulse_sends_auto_once
  on public.live_event_pulse_sends (event_id, kind, day)
  where source = 'auto';

alter table public.live_event_pulse_sends enable row level security;
revoke all on public.live_event_pulse_sends from public, anon, authenticated;
grant select on public.live_event_pulse_sends to authenticated;

create policy "Admins read pulse sends"
  on public.live_event_pulse_sends for select
  using (exists (select 1 from public.admin_roles ar where ar.user_id = (select auth.uid())));

-- ── 3. Push types — admin kill-switch + runaway brake in the usual place ────
-- daily_cap 2 = the scheduled daily send plus one manual follow-up per
-- user per day; anything past that is a bug or an itchy trigger finger,
-- and send-push drops it.

insert into public.notification_config (type, category, description, class, daily_cap) values
  ('event_rank_daily', 'social',
   'Per-registrant live-event placement pulse — their rank today, points, movement since the scoring day began and the gap to the row above; scheduled per event from /admin/events', 'social', 2),
  ('event_gate_reminder', 'social',
   'Per-registrant live-event referral-gate reminder — how many signups they still need and the deadline; only to registrants short of the gate, scheduled per event from /admin/events', 'social', 2)
on conflict (type) do nothing;

-- ── 4. Readiness — ONE definition shared by cron and Send now ───────────────
-- The dispatcher uses it to avoid claiming a day it cannot send on (a
-- hidden board at 6pm that is unhidden at 6:30 still gets that day's
-- pulse); the composer uses it so a manual send obeys the same rules.

create or replace function public._live_event_pulse_ready(p_event public.live_events, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'rank' then
          p_event.status = 'live'
      and not p_event.hidden
      and now() >= p_event.window_start_at
      and now() <  p_event.window_end_at
      and (p_event.lock_at is null or now() < p_event.lock_at)
    when 'gate' then
          p_event.status in ('scheduled', 'live', 'locked')
      and p_event.entry_gate_n > 0
      and public._live_event_gate_deadline(p_event) > now()
    else false
  end
$$;

revoke all on function public._live_event_pulse_ready(public.live_events, text) from public, anon, authenticated;

-- ── 5. Composer — builds each registrant's numbers and queues the POSTs ─────
-- Returns the recipient count; p_dry_run counts without queueing anything
-- (the panel's "who would get this right now").

create or replace function public.live_event_send_pulse(p_event_id uuid, p_kind text, p_dry_run boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev    public.live_events;
  v_token text;
  v_n     integer := 0;
  r       record;
begin
  if p_kind not in ('rank', 'gate') then
    raise exception 'unknown pulse kind %', p_kind;
  end if;

  select * into v_ev from public.live_events where id = p_event_id;
  if not found or not public._live_event_pulse_ready(v_ev, p_kind) then
    return 0;
  end if;

  if not p_dry_run then
    select decrypted_secret into v_token
      from vault.decrypted_secrets where name = 'shared_resolve_token';
  end if;

  if p_kind = 'rank' then
    -- Audience = the board as the app shows it: same gate mode, same rank
    -- delta reference as the ▲/▼ arrows. Opt-in scope pushes every scored
    -- registrant (zero-pointers included — "you're #14 on 0" is the
    -- activation nudge); global scope only score > 0, never the whole
    -- member base tied at the bottom.
    for r in
      -- materialized: sc is referenced three times, and each inline copy
      -- would be its own full scorer pass over the ledger.
      with sc as materialized (
        select s.user_id, s.rank::int as rank, s.score
          from public._live_event_scores(v_ev.id, v_ev.entry_gate_mode = 'entry') s
      )
      select sc.user_id, sc.rank, sc.score,
             (d.prev_rank - sc.rank)::int as rank_delta,
             (nxt.score - sc.score)       as gap_above,
             case when sc.rank = 1
                  then sc.score - (select score from sc x where x.rank = 2)
             end                          as lead
        from sc
        left join public._live_event_rank_deltas(v_ev.id) d on d.user_id = sc.user_id
        left join sc nxt on nxt.rank = sc.rank - 1
       where (v_ev.scope = 'opt_in' or sc.score > 0)
       order by sc.rank
    loop
      v_n := v_n + 1;
      if not p_dry_run then
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-resolve-token', v_token
          ),
          body := jsonb_build_object(
            'target_user_id', r.user_id,
            'type', 'event_rank_daily',
            'payload', jsonb_build_object(
              'event_id',   v_ev.id,
              'event_name', v_ev.name,
              'rank',       r.rank,
              'points',     r.score,
              'rank_delta', r.rank_delta,
              'gap_above',  r.gap_above,
              'lead',       r.lead
            )
          ),
          timeout_milliseconds := 5000
        );
      end if;
    end loop;

  else  -- gate
    for r in
      select lp.user_id,
             public._live_event_gate_count(v_ev.id, lp.user_id) as gate_count
        from public.live_event_participants lp
       where lp.event_id = v_ev.id
         and lp.disqualified_at is null
    loop
      if r.gate_count >= v_ev.entry_gate_n then
        continue;  -- gate met — congratulating daily is noise, not a cue
      end if;
      v_n := v_n + 1;
      if not p_dry_run then
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-resolve-token', v_token
          ),
          body := jsonb_build_object(
            'target_user_id', r.user_id,
            'type', 'event_gate_reminder',
            'payload', jsonb_build_object(
              'event_id',    v_ev.id,
              'event_name',  v_ev.name,
              'count',       r.gate_count,
              'required',    v_ev.entry_gate_n,
              'counting',    v_ev.entry_gate_counting,
              'gate_mode',   v_ev.entry_gate_mode,
              'deadline_at', public._live_event_gate_deadline(v_ev)
            )
          ),
          timeout_milliseconds := 5000
        );
      end if;
    end loop;
  end if;

  return v_n;
end;
$$;

revoke all on function public.live_event_send_pulse(uuid, text, boolean) from public, anon, authenticated;

-- ── 6. Dispatcher — pg_cron every 5 minutes ─────────────────────────────────
-- Fires each configured pulse once per London day, within a 90-minute
-- grace window of its set time: setting 18:00 at 17:00 fires at 18:00;
-- setting 09:00 at noon stays quiet until tomorrow instead of buzzing
-- everyone the moment the toggle lands.

create or replace function public.live_event_notification_dispatch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day     date := (now() at time zone 'Europe/London')::date;
  v_total   integer := 0;
  v_n       integer;
  v_send_at timestamptz;
  v_ev      public.live_events;
  r         record;
begin
  for r in
    select e.id, k.kind,
           case k.kind when 'rank' then e.notify_rank_at else e.notify_gate_at end as at_time
      from public.live_events e
      cross join (values ('rank'), ('gate')) k(kind)
     where case k.kind when 'rank' then e.notify_rank_at else e.notify_gate_at end is not null
       and e.status in ('scheduled', 'live', 'locked')
  loop
    select * into v_ev from public.live_events where id = r.id;
    if not public._live_event_pulse_ready(v_ev, r.kind) then
      continue;
    end if;

    v_send_at := (v_day::timestamp + r.at_time) at time zone 'Europe/London';
    if now() < v_send_at or now() >= v_send_at + interval '90 minutes' then
      continue;
    end if;

    -- The claim — only the tick that inserts sends.
    insert into public.live_event_pulse_sends (event_id, kind, day, source, recipients)
    values (r.id, r.kind, v_day, 'auto', 0)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    v_n := public.live_event_send_pulse(r.id, r.kind, false);
    update public.live_event_pulse_sends
       set recipients = v_n
     where event_id = r.id and kind = r.kind and day = v_day and source = 'auto';
    v_total := v_total + v_n;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.live_event_notification_dispatch() from public, anon, authenticated;

select cron.schedule(
  'live-event-pulse-dispatch',
  '*/5 * * * *',
  $$select public.live_event_notification_dispatch()$$
);

-- ── 7. Admin "Send now" ─────────────────────────────────────────────────────
-- Dry-run first from the panel so the admin confirms against a real
-- recipient count; the real send is logged with source 'manual'.

create or replace function public.admin_send_event_pulse(p_event_id uuid, p_kind text, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_kind not in ('rank', 'gate') then
    raise exception 'unknown pulse kind %', p_kind;
  end if;

  v_n := public.live_event_send_pulse(p_event_id, p_kind, p_dry_run);

  if not p_dry_run then
    insert into public.live_event_pulse_sends (event_id, kind, day, source, recipients)
    values (p_event_id, p_kind, (now() at time zone 'Europe/London')::date, 'manual', v_n);
  end if;

  return jsonb_build_object('recipients', v_n, 'sent', not p_dry_run);
end;
$$;

revoke all on function public.admin_send_event_pulse(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_send_event_pulse(uuid, text, boolean) to authenticated;
