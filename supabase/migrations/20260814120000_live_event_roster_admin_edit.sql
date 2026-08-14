-- =============================================================
-- Live event roster: admin add / remove
-- =============================================================
-- The registrations panel could only ever watch. On the night that
-- isn't enough: someone books at the venue, downloads POWR in the
-- queue and is past the eligibility cutoff, or a test row has to come
-- off a draft before it launches. join_live_event deliberately refuses
-- both of those — it speaks for the member, not for the door.
--
-- These two are the admin equivalents. They keep the invariants that
-- protect data (real account, event exists, not archived) and drop the
-- ones that only exist to keep members honest (cutoff, status window),
-- because an admin standing at the door IS the check.
--
-- "Update" needs nothing new: the only mutable state on a roster row is
-- the disqualification, and admin_disqualify_from_event already owns it.

-- =============================================================
-- admin_add_event_participants — put members on the roster by email
-- =============================================================
-- Bulk by design: the input on event night is a handful of addresses
-- read off a clipboard, not one form submission at a time. Every
-- address comes back in exactly one bucket — added, already, or
-- missing_emails — so nothing is silently dropped.
create or replace function public.admin_add_event_participants(
  p_event_id uuid,
  p_emails   text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event    public.live_events;
  v_clean    text[];
  v_missing  text[];
  v_resolved jsonb;
  v_new      jsonb;
  v_already  jsonb;
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
  -- A global event has no roster to join: everyone eligible is already
  -- scored, and the only rows here are disqualification markers.
  if v_event.scope <> 'opt_in' then
    raise exception 'This event is open to everyone — there is no roster to add to' using errcode = 'P0001';
  end if;

  -- Same normalisation as the booking export: trim, lowercase, drop
  -- blanks and anything without an @, de-duplicate.
  select coalesce(array_agg(distinct n.e), '{}'::text[])
    into v_clean
  from unnest(coalesce(p_emails, '{}'::text[])) as raw(e0)
  cross join lateral (select lower(btrim(raw.e0)) as e) n
  where n.e <> '' and position('@' in n.e) > 1;

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    raise exception 'No valid email addresses' using errcode = 'P0001';
  end if;

  -- A POWR account means an auth user WITH a profile row — the
  -- participants FK points at profiles, so an auth-only user would
  -- fail the insert rather than land in missing_emails where the
  -- admin can see it. Oldest account wins if an address somehow
  -- resolves twice, so a re-run adds the same person every time.
  select coalesce(jsonb_agg(jsonb_build_object(
           'email',   src.e,
           'user_id', m.id,
           'name',    m.name
         ) order by src.e), '[]'::jsonb)
    into v_resolved
  from (select distinct unnest(v_clean) as e) src
  cross join lateral (
    select p.id, coalesce(p.display_name, p.username, 'POWR member') as name
      from auth.users u
      join public.profiles p on p.id = u.id
     where lower(u.email) = src.e
     order by p.created_at
     limit 1
  ) m;

  select coalesce(array_agg(src.e order by src.e), '{}'::text[])
    into v_missing
  from (select distinct unnest(v_clean) as e) src
  where not exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = src.e
  );

  -- Split against the current roster. Someone already on it is reported,
  -- never rewritten — in particular a disqualified member stays
  -- disqualified, because clearing that is a separate decision with its
  -- own button (admin_disqualify_from_event).
  select
    coalesce(jsonb_agg(r.v) filter (where lp.user_id is null), '[]'::jsonb),
    coalesce(jsonb_agg(r.v || jsonb_build_object('disqualified', lp.disqualified_at is not null))
             filter (where lp.user_id is not null), '[]'::jsonb)
    into v_new, v_already
  from jsonb_array_elements(v_resolved) as r(v)
  left join public.live_event_participants lp
    on lp.event_id = v_event.id
   and lp.user_id = (r.v ->> 'user_id')::uuid;

  insert into public.live_event_participants (event_id, user_id)
  select v_event.id, (x ->> 'user_id')::uuid
    from jsonb_array_elements(v_new) as x
  on conflict (event_id, user_id) do nothing;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'event_participants_added', 'live_event', v_event.id::text,
          jsonb_build_object(
            'added',          jsonb_array_length(v_new),
            'already',        jsonb_array_length(v_already),
            'missing',        coalesce(array_length(v_missing, 1), 0),
            'added_user_ids', (select coalesce(jsonb_agg(x ->> 'user_id'), '[]'::jsonb)
                                 from jsonb_array_elements(v_new) as x)
          ));

  return jsonb_build_object(
    'added',          v_new,
    'already',        v_already,
    'missing_emails', to_jsonb(v_missing),
    -- The refreshed roster rides back with the write so the panel
    -- re-renders from one round trip, same as admin_set_event_bookings.
    'registrations',  public.admin_get_event_registrations(v_event.id)
  );
end;
$$;

-- =============================================================
-- admin_remove_event_participant — take a member off the roster
-- =============================================================
-- A full delete, not a disqualification: this is for rows that should
-- never have existed (a test registration, a wrong account), so it
-- leaves no trace on the board or in the funnel. Use the DQ button
-- when the registration was real and the CONDUCT wasn't — that keeps
-- the row and the audit trail.
--
-- Points already paid are untouched, exactly as with DQ. If results are
-- already frozen, in_results tells the caller a re-settle is owed.
create or replace function public.admin_remove_event_participant(
  p_event_id uuid,
  p_user_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event      public.live_events;
  v_removed    boolean := false;
  v_in_results boolean := false;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.live_event_results
     where event_id = v_event.id and user_id = p_user_id
  ) into v_in_results;

  delete from public.live_event_participants
   where event_id = v_event.id and user_id = p_user_id;
  v_removed := found;

  -- A second click on a row that's already gone is a no-op, not an
  -- error — the panel refetches either way.
  if v_removed then
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'event_participant_removed', 'live_event', v_event.id::text,
            jsonb_build_object('target_user', p_user_id, 'in_results', v_in_results));
  end if;

  return jsonb_build_object(
    'removed',       v_removed,
    'in_results',    v_in_results,
    'registrations', public.admin_get_event_registrations(v_event.id)
  );
end;
$$;

revoke all on function public.admin_add_event_participants(uuid, text[])  from public, anon;
revoke all on function public.admin_remove_event_participant(uuid, uuid)  from public, anon;
grant execute on function public.admin_add_event_participants(uuid, text[]) to authenticated;
grant execute on function public.admin_remove_event_participant(uuid, uuid) to authenticated;
