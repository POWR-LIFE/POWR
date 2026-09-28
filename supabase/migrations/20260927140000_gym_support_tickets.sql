-- =============================================================
-- Gym portal → support tickets: everything POWR has to act on
-- =============================================================
-- Until now a gym asking POWR for something only produced a Slack line, which
-- scrolls away. Each of these now also opens a ticket in /admin/support
-- (support_tickets, category gym_*), tagged with the gym, and the ticket
-- resolves itself when POWR acts in /admin/gyms:
--
--   gym_package       an owner asked to switch package
--                     → resolved when POWR sets it (or the request is cleared)
--   gym_clash_night   a Clash Night was asked for
--                     → resolved when POWR confirms or declines, or the gym
--                       calls it off first
--   gym_clash_cancel  a CONFIRMED night was called off: stand the crew down
--                     → POWR closes it by hand
--   gym_event_review  a gym's first event waits for POWR's OK
--                     → resolved when POWR approves or sends it back
--   gym_help          the team wrote to POWR from Settings (gym_submit_ticket)
--                     → POWR replies in /admin/support; the gym reads the
--                       reply in its portal (gym_tickets)
--
-- The automatic ones are raised by triggers on the rows themselves, so every
-- path that makes a request (portal, admin, a future function) opens one, and
-- no existing function body is re-stated here. A trigger that fails only
-- warns: a ticket never blocks the change it is about. `ref` says what a ticket is
-- about ({package}, {night_id}, {event_id}); an open ticket with the same ref
-- is updated rather than duplicated.

alter table public.support_tickets
  add column if not exists gym_partner_id uuid references public.partners(id) on delete set null,
  add column if not exists ref jsonb;

create index if not exists support_tickets_gym_idx
  on public.support_tickets (gym_partner_id, created_at desc) where gym_partner_id is not null;

comment on column public.support_tickets.gym_partner_id is
  'The gym a gym-portal ticket belongs to (category gym_*). NULL for app, web and brand tickets.';
comment on column public.support_tickets.ref is
  'What an automatic gym ticket is about: {"package":…}, {"night_id":…} or {"event_id":…}. Open tickets with the same ref are updated, not duplicated.';

-- ── Open (or refresh) a gym ticket ──────────────────────────────────────────
create or replace function public._gym_ticket(
  p_partner_id uuid, p_category text, p_subject text, p_message text, p_ref jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_email text;
  v_gym   text;
begin
  select name into v_gym from public.partners where id = p_partner_id;
  -- Whoever did it; failing that the gym's first owner; failing that a marker.
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    select u.email into v_email
      from public.gym_staff s join auth.users u on u.id = s.user_id
     where s.partner_id = p_partner_id and s.role = 'owner'
     order by s.created_at limit 1;
  end if;

  if p_ref is not null then
    select id into v_id from public.support_tickets
     where gym_partner_id = p_partner_id and category = p_category
       and ref @> p_ref and status in ('open', 'in_progress')
     order by created_at desc limit 1;
  end if;

  if v_id is not null then
    update public.support_tickets
       set subject = left(p_subject, 200), message = left(p_message, 5000), status = 'open'
     where id = v_id;
  else
    insert into public.support_tickets (user_id, email, category, subject, message, brand_name, gym_partner_id, ref)
    values (
      (select id from public.profiles where id = auth.uid()),
      coalesce(v_email, 'gym-portal@powr.life'),
      p_category, left(p_subject, 200), left(p_message, 5000), v_gym, p_partner_id, p_ref
    )
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- ── Resolve the open gym tickets about something ────────────────────────────
create or replace function public._gym_ticket_resolve(
  p_partner_id uuid, p_category text, p_ref jsonb, p_reply text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.support_tickets
     set status = 'resolved',
         admin_reply = coalesce(admin_reply || E'\n\n', '') || p_reply
   where gym_partner_id = p_partner_id and category = p_category
     and ref @> p_ref and status in ('open', 'in_progress')
$$;

revoke all on function public._gym_ticket(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._gym_ticket_resolve(uuid, text, jsonb, text) from public, anon, authenticated;

create or replace function public._gym_package_label(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p when 'clash' then 'Clash (free)' when 'clash_plus' then 'Clash+ (£129/month)'
                when 'pro' then 'Clash Pro (£349/month or £4,188/year)'
                when 'founding' then 'Founding Pro (£1,995/year, price locked)' else coalesce(p, '?') end
$$;

-- ── Package requests ────────────────────────────────────────────────────────
create or replace function public._gym_package_ticket_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.package_requested is not null
     and new.package_requested is distinct from old.package_requested then
    perform public._gym_ticket(new.partner_id, 'gym_package',
      'Package change: ' || public._gym_package_label(new.package_requested),
      'The gym asked to switch to ' || public._gym_package_label(new.package_requested) || '.' || E'\n' ||
      'Now on: ' || public._gym_package_label(new.package) ||
      case when new.trial_ends_at > now()
           then ' (free trial until ' || to_char(new.trial_ends_at at time zone 'Europe/London', 'FMDD Mon YYYY') || ')'
           else '' end || E'\n\n' ||
      'To do: agree billing, send the invoice, then set the package in Admin → Gym Portals (this ticket closes itself).',
      jsonb_build_object('package', true));
  elsif old.package_requested is not null and new.package_requested is null then
    perform public._gym_ticket_resolve(new.partner_id, 'gym_package', jsonb_build_object('package', true),
      case when new.package is distinct from old.package
           then 'Package set to ' || public._gym_package_label(new.package) || '.'
           else 'Request cleared; package stays ' || public._gym_package_label(new.package) || '.' end);
  end if;
  return null;
exception when others then
  -- A ticket must never block the change itself (an event approval, a package set).
  raise warning '[%] %', tg_name, sqlerrm;
  return null;
end;
$$;

drop trigger if exists gym_portal_settings_package_ticket on public.gym_portal_settings;
create trigger gym_portal_settings_package_ticket
  after update of package_requested on public.gym_portal_settings
  for each row execute function public._gym_package_ticket_trigger();

-- ── Clash Nights ────────────────────────────────────────────────────────────
create or replace function public._gym_clash_night_ticket_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref  jsonb := jsonb_build_object('night_id', new.id);
  v_day  text  := to_char(new.night_date, 'FMDay FMDD FMMonth YYYY');
begin
  if tg_op = 'INSERT' then
    perform public._gym_ticket(new.partner_id, 'gym_clash_night',
      'Clash Night request: ' || v_day,
      'Date: ' || v_day || ', starting ' || to_char(new.start_time, 'HH24:MI') || E'\n' ||
      'Backup: ' || coalesce(to_char(new.backup_date, 'FMDay FMDD FMMonth YYYY'), 'none') || E'\n' ||
      'Notes: ' || coalesce(new.notes, '(none)') || E'\n\n' ||
      'To do: check DJ, photographer and partner prizes for that night, then confirm or decline in Admin → Gym Portals (this ticket closes itself).',
      v_ref);
  elsif new.status is distinct from old.status then
    if new.status in ('confirmed', 'declined') then
      perform public._gym_ticket_resolve(new.partner_id, 'gym_clash_night', v_ref,
        initcap(new.status) || coalesce(': ' || new.admin_note, '.'));
    elsif new.status = 'cancelled' then
      perform public._gym_ticket_resolve(new.partner_id, 'gym_clash_night', v_ref, 'Called off by the gym.');
      if old.status = 'confirmed' then
        perform public._gym_ticket(new.partner_id, 'gym_clash_cancel',
          'Clash Night called off: ' || v_day,
          'The gym called off its CONFIRMED Clash Night on ' || v_day || '.' || E'\n\n' ||
          'To do: stand down the DJ and photographer, release the partner prizes, then close this ticket.',
          v_ref);
      end if;
    end if;
  end if;
  return null;
exception when others then
  -- A ticket must never block the change itself (an event approval, a package set).
  raise warning '[%] %', tg_name, sqlerrm;
  return null;
end;
$$;

drop trigger if exists gym_clash_nights_ticket on public.gym_clash_nights;
create trigger gym_clash_nights_ticket
  after insert or update of status on public.gym_clash_nights
  for each row execute function public._gym_clash_night_ticket_trigger();

-- ── A gym's first events wait for review ────────────────────────────────────
create or replace function public._gym_event_review_ticket_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref jsonb := jsonb_build_object('event_id', new.id);
begin
  if new.venue_partner_id is null then
    return null;
  end if;
  if new.review_status = 'pending'
     and (tg_op = 'INSERT' or old.review_status is distinct from 'pending') then
    perform public._gym_ticket(new.venue_partner_id, 'gym_event_review',
      'Event to review: ' || new.name,
      '"' || new.name || '" starts ' ||
      coalesce(to_char(new.window_start_at at time zone 'Europe/London', 'FMDy FMDD FMMon YYYY'), 'soon') ||
      '. The gym''s first events need POWR''s OK before they reach members.' || E'\n\n' ||
      'To do: check the prizes and rules, then approve or send it back in Admin → Gym Portals (this ticket closes itself).',
      v_ref);
  elsif tg_op = 'UPDATE' and old.review_status = 'pending' and new.review_status is distinct from 'pending' then
    perform public._gym_ticket_resolve(new.venue_partner_id, 'gym_event_review', v_ref,
      case new.review_status
        when 'approved' then 'Approved.'
        when 'rejected' then 'Sent back' || coalesce(': ' || new.review_note, '.')
        when 'pulled'   then 'Pulled' || coalesce(': ' || new.review_note, '.')
        else 'No longer waiting for review.' end);
  end if;
  return null;
exception when others then
  -- A ticket must never block the change itself (an event approval, a package set).
  raise warning '[%] %', tg_name, sqlerrm;
  return null;
end;
$$;

drop trigger if exists live_events_gym_review_ticket on public.live_events;
create trigger live_events_gym_review_ticket
  after insert or update of review_status on public.live_events
  for each row when (new.managed_by = 'gym')
  execute function public._gym_event_review_ticket_trigger();

revoke all on function public._gym_package_ticket_trigger() from public, anon, authenticated;
revoke all on function public._gym_clash_night_ticket_trigger() from public, anon, authenticated;
revoke all on function public._gym_event_review_ticket_trigger() from public, anon, authenticated;
revoke all on function public._gym_package_label(text) from public, anon, authenticated;

-- ── The team writes to POWR (Settings → Help) ───────────────────────────────
create or replace function public.gym_submit_ticket(p_partner_id uuid, p_topic text, p_subject text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._gym_role(p_partner_id);
  v_id   uuid;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role = 'admin' then
    raise exception 'Preview only. Write to the gym from the admin pages.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) < 3 then
    raise exception 'Add a subject' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) < 10 then
    raise exception 'Tell us a little more (10 characters or more)' using errcode = 'P0001';
  end if;
  if (select count(*) from public.support_tickets
       where gym_partner_id = p_partner_id and category = 'gym_help'
         and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'You''ve sent a few just now. We''ll answer those first.' using errcode = 'P0001';
  end if;

  v_id := public._gym_ticket(p_partner_id, 'gym_help',
    btrim(p_subject),
    '[' || coalesce(nullif(btrim(p_topic), ''), 'Other') || '] ' || btrim(p_message));

  perform public._gym_notify(p_partner_id, 'help_request',
    jsonb_build_object('topic', p_topic, 'subject', left(btrim(p_subject), 200)));
  return public.gym_tickets(p_partner_id);
end;
$$;

-- The gym's own tickets (all the team's, automatic ones included), newest first.
create or replace function public.gym_tickets(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'category', t.category, 'subject', t.subject, 'message', t.message,
             'status', t.status, 'reply', t.admin_reply, 'email', t.email,
             'created_at', t.created_at, 'updated_at', t.updated_at)
           order by t.created_at desc)
      from (select * from public.support_tickets
             where gym_partner_id = p_partner_id
             order by created_at desc limit 50) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.gym_submit_ticket(uuid, text, text, text) from public, anon;
revoke all on function public.gym_tickets(uuid) from public, anon;
grant execute on function public.gym_submit_ticket(uuid, text, text, text) to authenticated;
grant execute on function public.gym_tickets(uuid) to authenticated;
