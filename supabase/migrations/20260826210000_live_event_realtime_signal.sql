-- =============================================================
-- Live events: push the lifecycle to phones (the reveal button)
-- =============================================================
-- Jamie 2026-08-26: "we press the button and it changes everyone's
-- in-app screen to show the leaderboard. We don't want anyone having
-- to open, close and then open the app."
--
-- The app polls the board every 60 s while the League tab is mounted
-- and refetches on foreground — good enough for a week of scoring, not
-- for the moment a room full of phones is staring at a sealed board.
--
-- So every lifecycle change on a live event is broadcast on the public
-- Realtime topic `live-event:<slug>` by this trigger (realtime.send,
-- private = false). hooks/useLiveEventSignals.ts listens, invalidates
-- the live-event queries, and on the reveal steers the app to League.
--
-- Public topic, deliberately: the payload carries only what
-- get_live_event already hands every signed-in user (status, hidden,
-- revealed_at) — never the display token. Knowing a slug lets you
-- learn that an event changed state, which the app tells you anyway.
--
-- Exception-wrapped: a Realtime hiccup must never fail the admin's
-- Reveal or the cron's go-live. The 60 s poll is the fallback.

create or replace function public.live_event_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status              is distinct from old.status
     or new.hidden           is distinct from old.hidden
     or new.revealed_at      is distinct from old.revealed_at
     or new.preview_board_state is distinct from old.preview_board_state
  then
    begin
      perform realtime.send(
        jsonb_build_object(
          'event_id',    new.id,
          'slug',        new.slug,
          'status',      new.status,
          'hidden',      new.hidden,
          'revealed_at', new.revealed_at,
          'at',          now()
        ),
        'lifecycle',
        'live-event:' || new.slug,
        false
      );
    exception when others then
      raise warning 'live_event_signal: realtime.send failed for %: %', new.slug, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.live_event_signal() from public, anon, authenticated;

drop trigger if exists trg_live_event_signal on public.live_events;
create trigger trg_live_event_signal
  after update on public.live_events
  for each row
  execute function public.live_event_signal();

-- =============================================================
-- get_my_invite_progress — invites keep counting through the lock
-- =============================================================
-- Flow check 2026-08-26: the gate deadline (invite deadline, doors
-- close Fri) is AFTER the lock (Thu 23:00Z). The ticket must keep its
-- friends list and share tools through the locked days, so the event
-- pick here includes 'locked' — the deadline clause already bounds it.
-- Identical to the deployed version otherwise.
create or replace function public.get_my_invite_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.live_events;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event
    from public.live_events
   where status in ('scheduled', 'live', 'locked')
     and now() <= coalesce(conversion_deadline_at, window_end_at)
   order by window_start_at
   limit 1;

  return jsonb_build_object(
    'friends',         public._live_event_invitees(v_event.id, v_uid, false),
    'total',           (select count(*) from public.referrals r where r.referrer_id = v_uid),
    'converted_total', (select count(*) from public.referrals r
                         where r.referrer_id = v_uid and r.converted_at is not null),
    'event', case when v_event.id is null then null else jsonb_build_object(
      'event_id',            v_event.id,
      'invite_bonus_points', v_event.invite_bonus_points,
      'milestone_n',         v_event.invite_milestone_n,
      'milestone_bonus',     v_event.invite_milestone_bonus,
      'converted_for_event', (select count(*) from public.referrals r
                               where r.referrer_id = v_uid
                                 and r.event_id = v_event.id
                                 and r.converted_at is not null),
      'milestone_paid',      exists (select 1 from public.live_event_invite_milestones m
                                      where m.event_id = v_event.id and m.referrer_id = v_uid),
      'entry_gate_n',        v_event.entry_gate_n,
      'entry_gate_counting', v_event.entry_gate_counting,
      'gate_count',          public._live_event_gate_count(v_event.id, v_uid),
      'gate_met',            v_event.entry_gate_n <= 0
                             or public._live_event_gate_count(v_event.id, v_uid) >= v_event.entry_gate_n
    ) end
  );
end;
$$;
