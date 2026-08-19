-- =============================================================
-- LIVE EVENTS — the door board
-- =============================================================
-- "Who's registered, who's qualified, who's actually here." On the
-- night the ops panel answers the first two; this answers the third
-- without anyone holding a clipboard, by reading the venue geofence:
--
--   live_events.venue_partner_id  →  gym_visits.partner_id
--
-- Every geofence entry already writes a gym_visits row (the beacon
-- engine), so presence at the venue is a JOIN, not a new signal.
-- Nothing app-side changes.
--
-- What this is and isn't:
--   * A geofence visit is a STRONG signal, not a guest list. It needs
--     the app installed, location Always + Precise, and a live device
--     crossing the 25 m fence. It under-counts, never over-counts —
--     so there is a manual "mark arrived" for the door staff
--     (live_event_checkins), and the board reads geofence ∪ manual.
--   * The door band (which visits count as "arrived for the event")
--     is doors_open_at → doors_close_at when set. Unset, it falls back
--     to lock_at (the board locks, the doors open) and then window_end,
--     open-ended. The payload names which fallback it used so the UI
--     can say so instead of looking precise.
--   * FACTS only. Whether someone is "inside now" vs "last seen 50
--     minutes ago" is a judgement — it lives in shared/eventDoor.ts
--     with jest coverage, same split as admin Live Ops.
-- =============================================================

alter table public.live_events
  add column if not exists doors_open_at  timestamptz,
  add column if not exists doors_close_at timestamptz;

-- Manual check-ins — "an admin at the door IS the check" (same stance
-- as admin_add_event_participants). One row per person per event;
-- un-marking deletes it, so the table only ever holds live claims.
create table if not exists public.live_event_checkins (
  event_id      uuid not null references public.live_events (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users (id) on delete set null,
  note          text,
  primary key (event_id, user_id)
);

-- Admin-only through the definer RPCs: RLS on, no policies.
alter table public.live_event_checkins enable row level security;

-- Venue visits in a time band is the hot query on the night.
create index if not exists gym_visits_partner_started_idx
  on public.gym_visits (partner_id, started_at desc);

-- =============================================================
-- admin_get_event_door — the board payload
-- =============================================================
create or replace function public.admin_get_event_door(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event  public.live_events;
  v_from   timestamptz;
  v_to     timestamptz;
  v_source text;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- The door band. Explicit doors win; otherwise the night starts
  -- when the board locks; otherwise when the window ends.
  if v_event.doors_open_at is not null then
    v_from := v_event.doors_open_at;  v_source := 'doors';
    -- Doors open with no close: a night, not a week.
    v_to   := coalesce(v_event.doors_close_at, v_event.doors_open_at + interval '12 hours');
  elsif v_event.lock_at is not null then
    v_from := v_event.lock_at;        v_source := 'lock';   v_to := v_event.doors_close_at;
  else
    v_from := v_event.window_end_at;  v_source := 'window'; v_to := v_event.doors_close_at;
  end if;

  return (
    with roster as (
      select lp.user_id, lp.joined_at, lp.disqualified_at
        from public.live_event_participants lp
       where lp.event_id = v_event.id
    ),
    -- Venue visits overlapping the band, one line per person. A visit
    -- that began before doors and is still open counts (early arrival);
    -- the freshest proof is the newer of the two presence stamps (see
    -- shared/liveops.ts — last_confirmed_at moves on any confirm,
    -- last_proven_at only on one that cleared the accuracy gate).
    visits as (
      select gv.user_id,
             min(gv.started_at)                                   as first_entered_at,
             max(greatest(gv.started_at,
                          coalesce(gv.last_proven_at,    '-infinity'::timestamptz),
                          coalesce(gv.last_confirmed_at, '-infinity'::timestamptz))) as last_proof_at,
             max(gv.ended_at)                                     as last_ended_at,
             bool_or(gv.ended_at is null)                         as has_open_visit,
             count(*)::integer                                    as visit_count,
             (array_agg(gv.platform order by gv.started_at desc))[1] as platform,
             (array_agg(gv.status   order by gv.started_at desc))[1] as last_status
        from public.gym_visits gv
       where v_event.venue_partner_id is not null
         and gv.partner_id = v_event.venue_partner_id
         and gv.started_at < coalesce(v_to, now())
         and coalesce(gv.ended_at, now()) >= v_from
       group by gv.user_id
    ),
    manual as (
      select c.user_id, c.checked_in_at, c.note,
             coalesce(pa.display_name, pa.username) as by_name
        from public.live_event_checkins c
        left join public.profiles pa on pa.id = c.checked_in_by
       where c.event_id = v_event.id
    ),
    -- Everyone with a reason to be on the board: the roster, anyone
    -- the door marked, and anyone the fence saw (walk-ins — registered
    -- or not, they're in the building).
    people as (
      select user_id from roster
      union select user_id from manual
      union select user_id from visits
    ),
    rows_ as (
      select pe.user_id,
             coalesce(p.display_name, p.username, 'POWR member') as name,
             p.username,
             u.email,
             p.referral_code                        as member_id,
             (r.user_id is not null)                as on_roster,
             r.joined_at,
             r.disqualified_at,
             exists (select 1 from public.live_event_bookings b
                      where b.event_id = v_event.id
                        and b.email = lower(u.email))  as booked,
             g.gate_count,
             v.first_entered_at, v.last_proof_at, v.last_ended_at,
             coalesce(v.has_open_visit, false)     as has_open_visit,
             coalesce(v.visit_count, 0)            as visit_count,
             v.platform, v.last_status,
             m.checked_in_at                        as manual_checked_in_at,
             m.by_name                              as manual_by,
             m.note                                 as manual_note
        from people pe
        join public.profiles p on p.id = pe.user_id
        left join auth.users u on u.id = pe.user_id
        left join roster r on r.user_id = pe.user_id
        left join visits v on v.user_id = pe.user_id
        left join manual m on m.user_id = pe.user_id
        cross join lateral (
          select case when v_event.entry_gate_n > 0
                      then public._live_event_gate_count(v_event.id, pe.user_id)
                      else null end as gate_count
        ) g
       order by coalesce(p.display_name, p.username, 'POWR member'), pe.user_id
       limit 1000
    )
    select jsonb_build_object(
      'event', jsonb_build_object(
        'id',               v_event.id,
        'scope',            v_event.scope,
        'status',           v_event.status,
        'venue_partner_id', v_event.venue_partner_id,
        'venue_name',       (select pv.name from public.partners pv where pv.id = v_event.venue_partner_id),
        'gate_n',           v_event.entry_gate_n,
        'gate_counting',    v_event.entry_gate_counting,
        'band_from',        v_from,
        'band_to',          v_to,
        'band_source',      v_source,
        'doors_open_at',    v_event.doors_open_at,
        'doors_close_at',   v_event.doors_close_at
      ),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.name) from rows_ x
      ), '[]'::jsonb),
      'generated_at', now()
    )
  );
end;
$$;

revoke all on function public.admin_get_event_door(uuid) from public, anon;
grant execute on function public.admin_get_event_door(uuid) to authenticated;

-- =============================================================
-- admin_set_event_checkin — mark / unmark arrived by hand
-- =============================================================
-- Hands back the refreshed board so the panel never does a second
-- round trip (same contract as the roster RPCs).
create or replace function public.admin_set_event_checkin(
  p_event_id uuid,
  p_user_id  uuid,
  p_present  boolean,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.status = 'archived' then
    raise exception 'This event is archived' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;

  if p_present then
    insert into public.live_event_checkins (event_id, user_id, checked_in_by, note)
    values (p_event_id, p_user_id, auth.uid(), nullif(btrim(p_note), ''))
    on conflict (event_id, user_id) do update
      set note = coalesce(nullif(btrim(excluded.note), ''), public.live_event_checkins.note);
  else
    delete from public.live_event_checkins
     where event_id = p_event_id and user_id = p_user_id;
  end if;

  return public.admin_get_event_door(p_event_id);
end;
$$;

revoke all on function public.admin_set_event_checkin(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_event_checkin(uuid, uuid, boolean, text) to authenticated;
