-- =============================================================
-- Live event roster: search by profile
-- =============================================================
-- Adding by email assumes you already know the address. On the night
-- you often don't — you have a name, or the half of a username someone
-- read out. And email lives in auth.users, which the portal client
-- cannot read at all, so any search across it has to be a definer RPC.
--
-- Two changes:
--   1. admin_search_event_candidates — name/username/email search that
--      answers the question the admin actually has ("is this person
--      already in?"), not just "does this person exist".
--   2. admin_add_event_participants gains p_user_ids, so a picked
--      search result is added by identity instead of round-tripping
--      through an email that may be null (phone/OAuth accounts) or
--      simply different from the one they booked with.

-- =============================================================
-- admin_search_event_candidates — find a member, roster state included
-- =============================================================
create or replace function public.admin_search_event_candidates(
  p_event_id uuid,
  p_query    text,
  p_limit    int default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event   public.live_events;
  v_q       text;
  v_esc     text;
  v_pattern text;
  v_prefix  text;
  v_limit   int := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  v_q := lower(btrim(coalesce(p_query, '')));
  -- One character matches most of the user table — that's a table scan
  -- rendered as a dropdown, not a search.
  if length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  -- % and _ in a typed query are literal characters, not wildcards.
  v_esc     := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_pattern := '%' || v_esc || '%';
  v_prefix  := v_esc || '%';

  -- Ordering answers "which of these did you mean": addable before
  -- already-on-roster, exact identifier before prefix before a match
  -- buried mid-string, then alphabetical.
  return coalesce((
    select jsonb_agg(to_jsonb(m) order by m.on_roster, m.rank_hint, m.name)
      from (
        select p.id                                              as user_id,
               coalesce(p.display_name, p.username, 'POWR member') as name,
               p.username,
               u.email,
               lp.user_id is not null                            as on_roster,
               lp.disqualified_at is not null                    as disqualified,
               lp.joined_at,
               case
                 when lower(coalesce(u.email, '')) = v_q
                   or lower(coalesce(p.username, '')) = v_q then 0
                 when lower(coalesce(p.display_name, '')) like v_prefix escape '\'
                   or lower(coalesce(p.username, ''))     like v_prefix escape '\'
                   or lower(coalesce(u.email, ''))        like v_prefix escape '\' then 1
                 else 2
               end                                               as rank_hint
          from public.profiles p
          left join auth.users u on u.id = p.id
          left join public.live_event_participants lp
            on lp.event_id = v_event.id and lp.user_id = p.id
         where lower(coalesce(p.display_name, '')) like v_pattern escape '\'
            or lower(coalesce(p.username, ''))     like v_pattern escape '\'
            or lower(coalesce(u.email, ''))        like v_pattern escape '\'
         order by (lp.user_id is not null),
                  (case
                     when lower(coalesce(u.email, '')) = v_q
                       or lower(coalesce(p.username, '')) = v_q then 0
                     when lower(coalesce(p.display_name, '')) like v_prefix escape '\'
                       or lower(coalesce(p.username, ''))     like v_prefix escape '\'
                       or lower(coalesce(u.email, ''))        like v_prefix escape '\' then 1
                     else 2
                   end),
                  coalesce(p.display_name, p.username)
         limit v_limit
      ) m
  ), '[]'::jsonb);
end;
$$;

-- =============================================================
-- admin_add_event_participants — now also by user id
-- =============================================================
-- Dropped rather than replaced: adding a defaulted third argument to
-- the live 2-arg signature would leave both resolvable from the same
-- call and Postgres would refuse it as ambiguous.
drop function if exists public.admin_add_event_participants(uuid, text[]);

create or replace function public.admin_add_event_participants(
  p_event_id uuid,
  p_emails   text[]  default '{}',
  p_user_ids uuid[]  default '{}'
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

  if coalesce(array_length(v_clean, 1), 0) = 0
     and coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'Nobody to add' using errcode = 'P0001';
  end if;

  -- Both inputs resolve to the same shape and merge on user_id, so
  -- picking someone from search AND pasting their email adds them once.
  -- A POWR account means an auth user WITH a profile row — the
  -- participants FK points at profiles, so an auth-only user would
  -- fail the insert rather than land in missing_emails where the
  -- admin can see it. Oldest account wins if an address somehow
  -- resolves twice, so a re-run adds the same person every time.
  select coalesce(jsonb_agg(jsonb_build_object(
           'email',   d.email,
           'user_id', d.id,
           'name',    d.name
         ) order by d.name), '[]'::jsonb)
    into v_resolved
  from (
    -- One row per identity whichever way they arrived, so a person who
    -- is both pasted and picked is added (and counted) once.
    select distinct on (x.id) x.id, x.name, x.email
      from (
        select m.id, m.name, src.e as email
          from (select distinct unnest(v_clean) as e) src
          cross join lateral (
            select p.id, coalesce(p.display_name, p.username, 'POWR member') as name
              from auth.users u
              join public.profiles p on p.id = u.id
             where lower(u.email) = src.e
             order by p.created_at
             limit 1
          ) m
        union
        -- Ids come from the search RPC, which only ever returns real
        -- profiles — but a stale dropdown row must still not insert a
        -- dangling FK, so they are re-validated here.
        select p.id, coalesce(p.display_name, p.username, 'POWR member'), lower(u.email)
          from public.profiles p
          left join auth.users u on u.id = p.id
         where p.id = any (coalesce(p_user_ids, '{}'::uuid[]))
      ) x
     order by x.id, x.email nulls last
  ) d;

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

revoke all on function public.admin_search_event_candidates(uuid, text, int)        from public, anon;
revoke all on function public.admin_add_event_participants(uuid, text[], uuid[])    from public, anon;
grant execute on function public.admin_search_event_candidates(uuid, text, int)     to authenticated;
grant execute on function public.admin_add_event_participants(uuid, text[], uuid[]) to authenticated;
