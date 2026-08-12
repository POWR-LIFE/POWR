-- =============================================================
-- LIVE EVENTS — booking reconciliation
-- =============================================================
-- The venue sells tickets through its own system (One LDN books via
-- oneldn.com), so "booked a place" and "registered in POWR" are two
-- disjoint lists that only overlap by email. On the night the door
-- needs the intersection, and the week before, comms need the two
-- differences:
--
--   booked but not registered  → they'll turn up and not be in the app
--   registered but not booked  → they may not get through the door
--
-- Modelled as the raw export rather than a flag on the participant
-- row. A flag would need syncing every time either side changes;
-- storing the export makes "is this person booked" a join, which can
-- never drift, and keeps the booked-but-no-POWR-account emails that a
-- participant-side flag has nowhere to live.
--
-- The export is authoritative at upload time, so writing it REPLACES
-- the event's list — re-uploading a corrected export is the fix for a
-- bad one, and cancellations disappear on the next upload rather than
-- lingering as stale confirmations.
-- =============================================================

create table if not exists public.live_event_bookings (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.live_events (id) on delete cascade,
  -- Stored lowercased: the venue's export casing is not ours to trust.
  email       text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users (id) on delete set null,
  constraint live_event_bookings_email_lower check (email = lower(email))
);

create unique index if not exists live_event_bookings_event_email_idx
  on public.live_event_bookings (event_id, email);

-- Attendee emails are personal data and no client ever needs them:
-- RLS on with no policies at all, so only the definer RPCs below can
-- read or write the table.
alter table public.live_event_bookings enable row level security;

-- =============================================================
-- admin_set_event_bookings — replace the event's booking list
-- =============================================================
create or replace function public.admin_set_event_bookings(
  p_event_id uuid,
  p_emails   text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_clean text[];
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- Normalise once, here: trim, lowercase, drop blanks and anything
  -- without an @, de-duplicate. Pasted exports carry stray whitespace,
  -- header rows and repeated addresses.
  select coalesce(array_agg(distinct n.e), '{}'::text[])
    into v_clean
  from unnest(coalesce(p_emails, '{}'::text[])) as raw(e0)
  cross join lateral (select lower(btrim(raw.e0)) as e) n
  where n.e <> '' and position('@' in n.e) > 1;

  delete from public.live_event_bookings where event_id = v_event.id;

  if array_length(v_clean, 1) > 0 then
    insert into public.live_event_bookings (event_id, email, uploaded_by)
    select v_event.id, e, auth.uid() from unnest(v_clean) as e;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'event_bookings_set', 'live_event', v_event.id::text,
          jsonb_build_object('count', coalesce(array_length(v_clean, 1), 0)));

  return public.admin_get_event_bookings(v_event.id);
end;
$$;

revoke all on function public.admin_set_event_bookings(uuid, text[]) from public, anon;
grant execute on function public.admin_set_event_bookings(uuid, text[]) to authenticated;

-- =============================================================
-- admin_get_event_bookings — the intersection and both differences
-- =============================================================
create or replace function public.admin_get_event_bookings(p_event_id uuid)
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
    'uploaded_at', (select max(uploaded_at) from public.live_event_bookings where event_id = v_event.id),
    'booked_total', (select count(*) from public.live_event_bookings where event_id = v_event.id),
    'registered_total', (
      select count(*) from public.live_event_participants
       where event_id = v_event.id and disqualified_at is null
    ),

    -- Booked AND registered: the people the door and the app agree on.
    'confirmed', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email',   b.email,
               'user_id', u.id,
               'name',    coalesce(p.display_name, p.username, 'POWR member')
             ) order by coalesce(p.display_name, p.username, b.email))
        from public.live_event_bookings b
        join auth.users u on lower(u.email) = b.email
        join public.live_event_participants lp
          on lp.event_id = v_event.id and lp.user_id = u.id and lp.disqualified_at is null
        left join public.profiles p on p.id = u.id
       where b.event_id = v_event.id
    ), '[]'::jsonb),

    -- Booked a place but not in the event: either no POWR account at
    -- all, or an account that never registered. Both need chasing, and
    -- has_account tells comms which message to send.
    'booked_not_registered', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email',       b.email,
               'has_account', u.id is not null,
               'name',        coalesce(p.display_name, p.username)
             ) order by b.email)
        from public.live_event_bookings b
        left join auth.users u on lower(u.email) = b.email
        left join public.profiles p on p.id = u.id
       where b.event_id = v_event.id
         and not exists (
           select 1 from public.live_event_participants lp
            where lp.event_id = v_event.id and lp.user_id = u.id
              and lp.disqualified_at is null
         )
    ), '[]'::jsonb),

    -- Registered in the app with no booking against their account
    -- email — they may not get through the door, or they booked under
    -- a different address.
    'registered_not_booked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', lp.user_id,
               'email',   u.email,
               'name',    coalesce(p.display_name, p.username, 'POWR member')
             ) order by lp.joined_at desc)
        from public.live_event_participants lp
        left join auth.users u on u.id = lp.user_id
        left join public.profiles p on p.id = lp.user_id
       where lp.event_id = v_event.id
         and lp.disqualified_at is null
         and not exists (
           select 1 from public.live_event_bookings b
            where b.event_id = v_event.id and b.email = lower(u.email)
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_event_bookings(uuid) from public, anon;
grant execute on function public.admin_get_event_bookings(uuid) to authenticated;
