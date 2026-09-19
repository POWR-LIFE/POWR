-- ============================================================
-- Live events — admin invite panels scoped to the event's own period
--
-- Field report 2026-09-18: duplicating an archived event "pulled all the old
-- user data with it". Nothing was copied — the copy's roster, bookings,
-- check-ins, results and referrals were all empty. The admin page showed old
-- people anyway because two readers were never event-scoped:
--
--   admin_get_event_ops            funnel + pending count
--   admin_get_event_registrations  invite pipeline + bonus ledger
--
-- Both took EVERY pending signup in the database (`converted_at is null`)
-- and the ledger took the latest 100 invite payouts globally, so every
-- event — a minutes-old draft included — listed the last event's referrers
-- and their friends by name.
--
-- Now bounded by the event's invite period:
--   from   coalesce(entry_gate_since, created_at)
--   until  coalesce(conversion_deadline_at, window_end_at)
-- Conversions attributed to the event (referrals.event_id) are unchanged.
-- Side effect, intended: an archived event's panels stop accreting signups
-- that arrive after its deadline.
--
-- The door board needed no change — it reads venue visits inside the door
-- band, which is correct for a real night; the admin Duplicate action now
-- moves the copy's dates forward so the band no longer sits in the past.
-- ============================================================

create or replace function public.admin_get_event_registrations(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_since timestamptz;
  v_until timestamptz;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- The event's own invite period. A signup outside it can never convert
  -- into this event, so it has no business in this event's panels.
  v_since := coalesce(v_event.entry_gate_since, v_event.created_at);
  v_until := coalesce(v_event.conversion_deadline_at, v_event.window_end_at);

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
               where event_id = v_event.id
                  or (converted_at is null
                      and created_at >= v_since and created_at < v_until)
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

    -- The actual money: invite-bonus ledger rows paid inside this event's
    -- invite period. Transactions carry no event tag, so the period is the
    -- scope; during a preview run yours are the newest rows.
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
                 and created_at >= v_since and created_at < v_until
               order by created_at desc limit 100) t
        join public.profiles p on p.id = t.user_id
        left join auth.users u on u.id = t.user_id
    ), '[]'::jsonb)
  );
end;
$$;

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
  v_since  timestamptz;
  v_until  timestamptz;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- The event's own invite period. A signup outside it can never convert
  -- into this event, so it has no business in this event's panels.
  v_since := coalesce(v_event.entry_gate_since, v_event.created_at);
  v_until := coalesce(v_event.conversion_deadline_at, v_event.window_end_at);

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
        where r.event_id = p_event_id
           or (r.converted_at is null
               and r.created_at >= v_since and r.created_at < v_until)
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
      select count(*) from public.referrals r
       where r.converted_at is null
         and r.created_at >= v_since and r.created_at < v_until
    ),
    'funnel', coalesce(v_funnel, '[]'::jsonb)
  );
end;
$$;
