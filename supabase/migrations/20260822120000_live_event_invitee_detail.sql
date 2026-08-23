-- =============================================================
-- Live events: who is behind the invite count
-- =============================================================
-- Every invite surface we have shows a NUMBER — "3 / 5" on the
-- ticket card, "3 / 5" in the door board's Gate column, a Signups
-- column in the ops funnel. None of them can answer the next
-- question anyone asks: WHICH friends is that?
--
-- One helper answers it everywhere, so no surface can ever quote a
-- different set of people than the count it sits under.

-- =============================================================
-- _live_event_invitees — one referrer's people, event-aware
-- =============================================================
-- Returns EVERY friend p_uid has ever referred (that is the honest
-- list — a count that hides the ones that didn't count is how "I
-- invited four people and it says 1" happens), each flagged with
-- whether it counts toward p_event_id right now.
--
-- `counts_for_event` mirrors the event's ACTUAL scoring mode so the
-- flags always sum to the number on screen:
--   • entry gate set  → the _live_event_gate_count predicate exactly
--                       (entry_gate_since window, conversions-only
--                       when the gate counts conversions)
--   • no gate         → the invite milestone's basis: attributed to
--                       this event AND converted
-- Keep the two in lockstep; if _live_event_gate_count ever changes,
-- change the gate branch here in the same migration.
--
-- p_with_email is for the admin callers only. The app RPC passes
-- false: a referrer may see who joined with their code, never their
-- email address.
create or replace function public._live_event_invitees(
  p_event_id   uuid,
  p_uid        uuid,
  p_with_email boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'referred_id',      f.referred_id,
        'name',             f.name,
        'display_name',     f.display_name,
        'username',         f.username,
        'avatar_url',       f.avatar_url,
        'member_id',        f.member_id,
        'email',            case when p_with_email then f.email else null end,
        'created_at',       f.created_at,
        'converted_at',     f.converted_at,
        'converted',        f.converted_at is not null,
        'for_event',        f.for_event,
        'counts_for_event', f.counts_for_event
      )
      -- The ones that count lead, then the freshest signups: the
      -- order the list is read in.
      order by f.counts_for_event desc, f.created_at desc
    ), '[]'::jsonb)
  from (
    select r.referred_id,
           coalesce(p.display_name, p.username, 'POWR member') as name,
           p.display_name,
           p.username,
           p.avatar_url,
           p.referral_code as member_id,
           u.email,
           r.created_at,
           r.converted_at,
           (ev.id is not null and r.event_id = ev.id) as for_event,
           case
             when ev.id is null then false
             when ev.entry_gate_n > 0 then
               (ev.entry_gate_since is null or r.created_at >= ev.entry_gate_since)
               and (ev.entry_gate_counting <> 'conversions' or r.converted_at is not null)
             else (r.event_id = ev.id and r.converted_at is not null)
           end as counts_for_event
      from public.referrals r
      join public.profiles p on p.id = r.referred_id
      left join auth.users u on u.id = r.referred_id
      -- Null p_event_id (no live event) joins to nothing: every row
      -- comes back flagged as counting for nothing, which is true.
      left join public.live_events ev on ev.id = p_event_id
     where r.referrer_id = p_uid
     order by r.created_at desc
     limit 200
  ) f
$$;

-- Internal: only ever called from inside the definer RPCs below.
revoke all on function public._live_event_invitees(uuid, uuid, boolean)
  from public, anon, authenticated;

-- =============================================================
-- get_my_invite_progress — friends carry their own state
-- =============================================================
-- Unchanged shape. `friends` keeps every key it had (display_name,
-- username, avatar_url, converted, converted_at) so an un-updated
-- client renders exactly as before, and gains created_at, for_event
-- and counts_for_event for the ones that have the new card.
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
   where status in ('scheduled', 'live')
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

-- =============================================================
-- admin_get_event_registrations — roster rows carry their invitees
-- =============================================================
-- Body identical to 20260818200000 except: participants gain an
-- invite summary + the people behind it, and pipeline rows gain the
-- two ids (the table could name a referrer but not link to them).
create or replace function public.admin_get_event_registrations(p_event_id uuid)
returns jsonb
language plpgsql
stable
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

  return jsonb_build_object(
    -- Who's in: the raw opt-in roster, newest first.
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',         lp.user_id,
               'name',            coalesce(p.display_name, p.username, 'POWR member'),
               'username',        p.username,
               'email',           u.email,
               'member_id',       p.referral_code,
               'joined_at',       lp.joined_at,
               'disqualified_at', lp.disqualified_at,
               'booking_opened_at', lp.booking_link_opened_at,
               'booked',          exists (
                                    select 1 from public.live_event_bookings b
                                     where b.event_id = v_event.id
                                       and b.email = lower(u.email)
                                  ),
               -- Their invites, three numbers and the names behind
               -- them. `invites_counting` is the one that matches the
               -- gate/milestone count the member sees in the app.
               'invites',         inv.people,
               'invites_total',   jsonb_array_length(inv.people),
               'invites_counting', (
                                    select count(*) from jsonb_array_elements(inv.people) e
                                     where (e->>'counts_for_event')::boolean
                                  ),
               'invites_converted', (
                                    select count(*) from jsonb_array_elements(inv.people) e
                                     where (e->>'converted')::boolean
                                  ),
               'gate_count',      case when v_event.entry_gate_n > 0
                                       then public._live_event_gate_count(v_event.id, lp.user_id)
                                       else null end
             ) order by lp.joined_at desc)
        from (select * from public.live_event_participants
               where event_id = v_event.id
               order by joined_at desc limit 500) lp
        join public.profiles p on p.id = lp.user_id
        left join auth.users u on u.id = lp.user_id
        cross join lateral (
          select public._live_event_invitees(v_event.id, lp.user_id, true) as people
        ) inv
    ), '[]'::jsonb),

    -- The invite pipeline: conversions attributed to THIS event plus
    -- still-pending signups (they can convert into it until the deadline).
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referrer_id',   r.referrer_id,
               'referred_id',   r.referred_id,
               'referrer_name', coalesce(pr.display_name, pr.username, 'POWR member'),
               'referred_name', coalesce(pd.display_name, pd.username, 'POWR member'),
               'referred_email', u.email,
               'created_at',    r.created_at,
               'converted_at',  r.converted_at,
               'attributed',    r.event_id = v_event.id
             ) order by coalesce(r.converted_at, r.created_at) desc)
        from (select * from public.referrals
               where event_id = v_event.id or converted_at is null
               order by coalesce(converted_at, created_at) desc limit 200) r
        join public.profiles pr on pr.id = r.referrer_id
        join public.profiles pd on pd.id = r.referred_id
        left join auth.users u on u.id = r.referred_id
    ), '[]'::jsonb),

    -- Milestone payouts for this event.
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referrer_name',   coalesce(p.display_name, p.username, 'POWR member'),
               'converted_count', m.converted_count,
               'points_paid',     m.points_paid,
               'created_at',      m.created_at
             ) order by m.created_at desc)
        from public.live_event_invite_milestones m
        join public.profiles p on p.id = m.referrer_id
       where m.event_id = v_event.id
    ), '[]'::jsonb),

    -- The actual money: latest invite-bonus ledger rows. Transactions
    -- carry no event tag, so this is a global feed — labelled as such
    -- in the UI; during a preview run yours are the newest rows.
    'bonus_ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',        coalesce(p.display_name, p.username, 'POWR member'),
               'email',       u.email,
               'amount',      t.amount,
               'source',      t.source,
               'description', t.description,
               'created_at',  t.created_at
             ) order by t.created_at desc)
        from (select * from public.point_transactions
               where source in ('referral_sent', 'referral_received', 'invite_milestone')
               order by created_at desc limit 100) t
        join public.profiles p on p.id = t.user_id
        left join auth.users u on u.id = t.user_id
    ), '[]'::jsonb)
  );
end;
$$;

-- =============================================================
-- admin_get_event_ops — funnel rows carry their invitees
-- =============================================================
-- Body identical to 20260729180000 except the funnel's `invitees`.
create or replace function public.admin_get_event_ops(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event  public.live_events;
  v_funnel jsonb;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select jsonb_agg(to_jsonb(s)) into v_funnel
    from (
      select r.referrer_id,
             coalesce(p.display_name, p.username, 'POWR member') as referrer_name,
             count(*)::integer                                          as signups,
             count(*) filter (where r.converted_at is null)::integer     as pending,
             count(*) filter (where r.converted_at is not null)::integer as converted,
             exists (
               select 1 from public.live_event_invite_milestones m
                where m.event_id = p_event_id and m.referrer_id = r.referrer_id
             ) as milestone_paid,
             -- Every friend this referrer has brought, so the row can
             -- open into the names behind its own numbers.
             public._live_event_invitees(p_event_id, r.referrer_id, true) as invitees
        from public.referrals r
        join public.profiles p on p.id = r.referrer_id
        where r.converted_at is null
           or r.event_id = p_event_id
        group by r.referrer_id, p.display_name, p.username
        order by converted desc, signups desc
        limit 100
    ) s;

  return jsonb_build_object(
    'eligible_count', (
      select count(*)
        from public.profiles p
       where p.created_at < coalesce(v_event.eligibility_cutoff_at, v_event.window_start_at)
         and not exists (select 1 from public.live_event_participants lp
                          where lp.event_id = v_event.id and lp.user_id = p.id
                            and lp.disqualified_at is not null)
         and (
           (v_event.scope = 'global' and p.show_on_leaderboard = true)
           or
           (v_event.scope = 'opt_in' and exists (
             select 1 from public.live_event_participants lp
             where lp.event_id = v_event.id and lp.user_id = p.id))
         )
    ),
    'participant_count',
      case
        when v_event.scope = 'opt_in' then (
          select count(*) from public.live_event_participants lp
           where lp.event_id = v_event.id and lp.disqualified_at is null
        )
        else (
          -- Global-scope has no join rows; count actual scorers instead.
          select count(*) from public._live_event_scores(v_event.id) s
           where s.score <> 0
        )
      end,
    'disqualified_count', (
      select count(*) from public.live_event_participants lp
       where lp.event_id = v_event.id and lp.disqualified_at is not null
    ),
    'results_count', (
      select count(*) from public.live_event_results r where r.event_id = v_event.id
    ),
    'converted_count', (
      select count(*) from public.referrals r
       where r.event_id = v_event.id and r.converted_at is not null
    ),
    'pending_referrals', (
      select count(*) from public.referrals r where r.converted_at is null
    ),
    'funnel', coalesce(v_funnel, '[]'::jsonb)
  );
end;
$$;

-- =============================================================
-- admin_get_event_door — the Gate cell can name its friends
-- =============================================================
-- Body identical to 20260819150000 except `gate_friends` on each
-- row, populated only when the event actually has a gate (same
-- condition as gate_count — a null cell has nothing to open).
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
             g.gate_friends,
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
                      else null end as gate_count,
                 case when v_event.entry_gate_n > 0
                      then public._live_event_invitees(v_event.id, pe.user_id, false)
                      else null end as gate_friends
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
