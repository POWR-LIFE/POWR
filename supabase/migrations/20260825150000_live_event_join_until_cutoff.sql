-- Joining a live event stays open until the eligibility cutoff, not the
-- scoring end.
--
-- Jamie's call 2026-08-25: someone can create an account, join, and bring
-- their invites right up to the event day itself. Points are still only
-- counted inside [window_start_at, window_end_at) — the board is a windowed
-- sum over the ledger, so a late joiner simply has fewer scoring days — but
-- the entry gate (referrals) and the roster don't close with the window.
--
-- `eligibility_cutoff_at` already governs who may compete (account created
-- before it) in `_live_event_scores` / `_live_event_viewer` / `admin_get_event_ops`.
-- This makes it the join deadline as well, so there is ONE knob for "entry
-- closes" and it defaults to the scoring end as before when left blank.
-- The same cutoff has to be reachable, so an event with cutoff before its
-- window end behaves exactly as it did.

create or replace function public.join_live_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_event   public.live_events;
  v_preview boolean := false;
  v_closes  timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if found and v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
  end if;
  if not found or v_event.status = 'archived' or (v_event.status = 'draft' and not v_preview) then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.scope <> 'opt_in' then
    raise exception 'This event does not require joining' using errcode = 'P0001';
  end if;

  -- Entry closes at the eligibility cutoff (falls back to the scoring end).
  -- Same instant the account-age check below uses, so "you can still join"
  -- and "your account counts" can never disagree.
  v_closes := coalesce(v_event.eligibility_cutoff_at, v_event.window_end_at);
  if (v_event.status not in ('scheduled', 'live') and not v_preview) or now() >= v_closes then
    raise exception 'This event can no longer be joined' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid
      and p.created_at < v_closes
  ) then
    raise exception 'Your account was created after the eligibility cutoff' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.live_event_participants lp
    where lp.event_id = v_event.id and lp.user_id = v_uid
      and lp.disqualified_at is not null
  ) then
    raise exception 'You cannot rejoin this event' using errcode = 'P0001';
  end if;

  insert into public.live_event_participants (event_id, user_id)
  values (v_event.id, v_uid)
  on conflict (event_id, user_id) do nothing;

  return public._live_event_viewer(v_event, v_uid);
end;
$function$;
