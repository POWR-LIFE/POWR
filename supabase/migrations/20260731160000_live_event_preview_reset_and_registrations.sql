-- =============================================================
-- LIVE EVENTS — repeatable preview testing + admin registrations view
-- =============================================================
-- 1) reset_live_event_preview: a previewer who registered against a
--    draft can remove their own join row and run the flow again.
--    Hard-gated to preview drafts — there is deliberately NO general
--    "leave event" path (launched-event joins are one-way).
-- 2) admin_get_event_registrations: who registered, the invite
--    pipeline, and the actual bonus transactions — so the reward
--    mechanics can be eyeballed end-to-end from /admin/events at any
--    status (drafts included, for preview test runs).

create or replace function public.reset_live_event_preview(p_event_id uuid)
returns jsonb
language plpgsql
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

  select * into v_event from public.live_events where id = p_event_id;
  if not found
     or v_event.status <> 'draft'
     or not public._live_event_previewer(v_event, v_uid) then
    raise exception 'Not a preview event' using errcode = 'P0002';
  end if;

  delete from public.live_event_participants
   where event_id = v_event.id and user_id = v_uid and disqualified_at is null;

  return public._live_event_viewer(v_event, v_uid);
end;
$$;

revoke all on function public.reset_live_event_preview(uuid) from public, anon;
grant execute on function public.reset_live_event_preview(uuid) to authenticated;

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
               'joined_at',       lp.joined_at,
               'disqualified_at', lp.disqualified_at
             ) order by lp.joined_at desc)
        from (select * from public.live_event_participants
               where event_id = v_event.id
               order by joined_at desc limit 500) lp
        join public.profiles p on p.id = lp.user_id
        left join auth.users u on u.id = lp.user_id
    ), '[]'::jsonb),

    -- The invite pipeline: conversions attributed to THIS event plus
    -- still-pending signups (they can convert into it until the deadline).
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
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

revoke all on function public.admin_get_event_registrations(uuid) from public, anon;
grant execute on function public.admin_get_event_registrations(uuid) to authenticated;
