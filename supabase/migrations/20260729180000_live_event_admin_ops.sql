-- =============================================================
-- LIVE EVENTS — admin ops dashboard backend (ticket 6)
-- =============================================================
-- Spec: context/LIVE_EVENTS_PLAN.md §4.3–4.4. Two additions:
--
--   * admin_get_event_ops — the numbers the ops dashboard shows
--     around the through-blur standings (which already come from
--     admin_get_event_leaderboard): eligibility/participation
--     counts and the invite funnel by referrer.
--
--   * admin_disqualify_from_event — event-scoped only. Removes a
--     user from the board (the scorer skips disqualified users)
--     without touching their points; session rejection with its
--     penalty rows lives in SessionReview, not here. After a
--     disqualification the admin re-settles (allowed until
--     Reveal) so a frozen snapshot can't keep a removed user.
-- =============================================================

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

  -- Funnel by referrer: conversions attributed to THIS event, plus
  -- still-pending signups (they can convert into it until the
  -- deadline). "Codes shared" isn't a tracked signal — signups are
  -- the top of the funnel we can actually see.
  select jsonb_agg(row order by (row->>'converted')::int desc, (row->>'signups')::int desc)
    into v_funnel
    from (
      select jsonb_build_object(
               'referrer_id',    r.referrer_id,
               'referrer_name',  coalesce(p.display_name, p.username, 'POWR member'),
               'signups',        count(*),
               'converted',      count(*) filter (where r.event_id = p_event_id and r.converted_at is not null),
               'pending',        count(*) filter (where r.converted_at is null),
               'milestone_paid', exists (select 1 from public.live_event_invite_milestones m
                                          where m.event_id = p_event_id and m.referrer_id = r.referrer_id)
             ) as row
        from public.referrals r
        join public.profiles p on p.id = r.referrer_id
       where r.converted_at is null
          or r.event_id = p_event_id
       group by r.referrer_id, p.display_name, p.username
       limit 100
    ) t;

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
    'participant_count', (
      select count(*) from public.live_event_participants lp
       where lp.event_id = v_event.id and lp.disqualified_at is null
    ),
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

-- Event-scoped disqualification. Requalifying a global-scope user
-- deletes the marker row (it only ever existed to hold the
-- disqualification); for opt_in scope the row is their join, so it
-- is restored instead of deleted.
create or replace function public.admin_disqualify_from_event(
  p_event_id     uuid,
  p_user_id      uuid,
  p_disqualified boolean
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

  if p_disqualified then
    insert into public.live_event_participants (event_id, user_id, disqualified_at, disqualified_by)
    values (p_event_id, p_user_id, now(), auth.uid())
    on conflict (event_id, user_id)
      do update set disqualified_at = excluded.disqualified_at,
                    disqualified_by = excluded.disqualified_by;
  else
    if v_event.scope = 'global' then
      delete from public.live_event_participants
       where event_id = p_event_id and user_id = p_user_id;
    else
      update public.live_event_participants
         set disqualified_at = null, disqualified_by = null
       where event_id = p_event_id and user_id = p_user_id;
    end if;
  end if;

  return jsonb_build_object('disqualified', p_disqualified);
end;
$$;

revoke all on function public.admin_get_event_ops(uuid)                        from public, anon;
revoke all on function public.admin_disqualify_from_event(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_get_event_ops(uuid)                        to authenticated;
grant execute on function public.admin_disqualify_from_event(uuid, uuid, boolean) to authenticated;
