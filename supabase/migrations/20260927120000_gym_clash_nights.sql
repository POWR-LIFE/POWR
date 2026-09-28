-- =============================================================
-- Clash Nights: a Clash Pro gym books its nights with POWR
-- =============================================================
-- Clash Pro and Founding Pro include 4 POWR Clash Nights a year, one per
-- quarter: POWR brings the DJ, photographer and partner prizes. The gym picks
-- a date in its portal (/venue/clash-nights); POWR gets a Slack line and
-- confirms or declines it in /admin/gyms.
--
-- Rules (enforced here, shown in the portal):
--   * the package must be Clash Pro or Founding Pro. The free trial does NOT
--     count: a night costs POWR a crew, so it comes with a paid package.
--   * at least 28 days' notice (London dates), at most a year ahead.
--   * one night per calendar quarter (a declined or cancelled one frees it).
--   * a date POWR has already confirmed for another gym can't be asked for.
-- Founding Pro books all four at signing: the same rules, four requests.

create table if not exists public.gym_clash_nights (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete cascade,
  night_date    date not null,
  start_time    time not null default '19:00',
  backup_date   date,
  notes         text check (notes is null or char_length(notes) <= 600),
  status        text not null default 'requested'
                check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  admin_note    text check (admin_note is null or char_length(admin_note) <= 600),
  requested_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id) on delete set null,
  cancelled_at  timestamptz
);

create index if not exists gym_clash_nights_partner_idx on public.gym_clash_nights (partner_id, night_date);
create index if not exists gym_clash_nights_status_idx on public.gym_clash_nights (status, night_date);

comment on table public.gym_clash_nights is
  'A gym''s Clash Night bookings (Clash Pro / Founding Pro). Gyms write only through gym_book_clash_night / gym_cancel_clash_night; admins confirm or decline in /admin/gyms.';

alter table public.gym_clash_nights enable row level security;

drop policy if exists "Admins manage clash nights" on public.gym_clash_nights;
create policy "Admins manage clash nights" on public.gym_clash_nights
  for all to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- ── The rules, in one place ─────────────────────────────────────────────────
create or replace function public._clash_night_rules()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('lead_days', 28, 'horizon_days', 365, 'per_year', 4)
$$;

revoke all on function public._clash_night_rules() from public, anon, authenticated;

-- ── What the portal page reads ──────────────────────────────────────────────
create or replace function public.gym_clash_nights(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pkg   text;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_rules jsonb := public._clash_night_rules();
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select package into v_pkg from public.gym_portal_settings where partner_id = p_partner_id;

  return jsonb_build_object(
    'included',     coalesce(v_pkg in ('pro', 'founding'), false),
    'package',      v_pkg,
    'today',        v_today,
    'first_date',   v_today + (v_rules ->> 'lead_days')::int,
    'last_date',    v_today + (v_rules ->> 'horizon_days')::int,
    'lead_days',    (v_rules ->> 'lead_days')::int,
    'per_year',     (v_rules ->> 'per_year')::int,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'night_date', n.night_date, 'start_time', to_char(n.start_time, 'HH24:MI'),
               'backup_date', n.backup_date, 'notes', n.notes, 'status', n.status,
               'admin_note', n.admin_note, 'created_at', n.created_at, 'decided_at', n.decided_at)
             order by n.night_date desc)
        from public.gym_clash_nights n
       where n.partner_id = p_partner_id
    ), '[]'::jsonb),
    -- Nights POWR has confirmed at other gyms: dates only, never whose.
    'taken', coalesce((
      select jsonb_agg(distinct n.night_date)
        from public.gym_clash_nights n
       where n.status = 'confirmed' and n.partner_id <> p_partner_id and n.night_date >= v_today
    ), '[]'::jsonb)
  );
end;
$$;

-- ── A gym asks for a night ──────────────────────────────────────────────────
create or replace function public.gym_book_clash_night(
  p_partner_id uuid, p_date date, p_start_time time default '19:00',
  p_backup_date date default null, p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text := public._gym_role(p_partner_id);
  v_pkg   text;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_rules jsonb := public._clash_night_rules();
  v_first date;
  v_last  date;
  v_id    uuid;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role = 'admin' then
    raise exception 'Preview only. Book a gym''s Clash Night from the admin pages.' using errcode = 'P0001';
  end if;

  select package into v_pkg from public.gym_portal_settings where partner_id = p_partner_id for update;
  if coalesce(v_pkg, '') not in ('pro', 'founding') then
    raise exception 'Clash Nights come with Clash Pro. See Package in your portal to change it.' using errcode = 'P0001';
  end if;

  v_first := v_today + (v_rules ->> 'lead_days')::int;
  v_last  := v_today + (v_rules ->> 'horizon_days')::int;
  if p_date is null then
    raise exception 'Pick a date' using errcode = 'P0001';
  end if;
  if p_date < v_first then
    raise exception 'Clash Nights need % days'' notice. The first date you can pick is %.',
      v_rules ->> 'lead_days', to_char(v_first, 'FMDD FMMonth YYYY') using errcode = 'P0001';
  end if;
  if p_date > v_last then
    raise exception 'You can book up to a year ahead.' using errcode = 'P0001';
  end if;
  if p_start_time is null or p_start_time < '06:00' or p_start_time > '21:00' then
    raise exception 'Pick a start time between 6am and 9pm' using errcode = 'P0001';
  end if;
  if p_backup_date is not null and (p_backup_date < v_first or p_backup_date > v_last or p_backup_date = p_date) then
    raise exception 'The backup date needs the same notice, and must be a different day' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.gym_clash_nights
              where partner_id = p_partner_id and status in ('requested', 'confirmed')
                and date_trunc('quarter', night_date) = date_trunc('quarter', p_date)) then
    raise exception 'You already have a Clash Night in that quarter. It''s one per quarter.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gym_clash_nights
              where status = 'confirmed' and night_date = p_date and partner_id <> p_partner_id) then
    raise exception 'That night is already taken. Pick another date.' using errcode = 'P0001';
  end if;

  insert into public.gym_clash_nights (partner_id, night_date, start_time, backup_date, notes, requested_by)
  values (p_partner_id, p_date, p_start_time, p_backup_date, nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;

  perform public._gym_audit(p_partner_id, 'gym_clash_night_requested',
    jsonb_build_object('id', v_id, 'date', p_date, 'start_time', p_start_time, 'backup_date', p_backup_date));
  perform public._gym_notify(p_partner_id, 'clash_night_request',
    jsonb_build_object('date', p_date, 'start_time', to_char(p_start_time, 'HH24:MI'),
                       'backup_date', p_backup_date, 'notes', nullif(btrim(p_notes), ''), 'package', v_pkg));
  return public.gym_clash_nights(p_partner_id);
end;
$$;

-- ── A gym calls one off (asked for or confirmed, not yet happened) ──────────
create or replace function public.gym_cancel_clash_night(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n    public.gym_clash_nights;
  v_role text;
begin
  select * into v_n from public.gym_clash_nights where id = p_id for update;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  v_role := public._gym_role(v_n.partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role = 'admin' then
    raise exception 'Preview only. Change a gym''s Clash Night from the admin pages.' using errcode = 'P0001';
  end if;
  if v_n.status not in ('requested', 'confirmed') then
    raise exception 'That night isn''t booked' using errcode = 'P0001';
  end if;
  if v_n.night_date < (now() at time zone 'Europe/London')::date then
    raise exception 'That night has already happened' using errcode = 'P0001';
  end if;

  update public.gym_clash_nights set status = 'cancelled', cancelled_at = now() where id = p_id;

  perform public._gym_audit(v_n.partner_id, 'gym_clash_night_cancelled',
    jsonb_build_object('id', p_id, 'date', v_n.night_date, 'was', v_n.status));
  perform public._gym_notify(v_n.partner_id, 'clash_night_cancelled',
    jsonb_build_object('date', v_n.night_date, 'was', v_n.status));
  return public.gym_clash_nights(v_n.partner_id);
end;
$$;

-- ── POWR confirms or declines (admin) ───────────────────────────────────────
create or replace function public.admin_decide_clash_night(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.gym_clash_nights;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_decision not in ('confirmed', 'declined') then
    raise exception 'Confirm or decline' using errcode = 'P0001';
  end if;
  select * into v_n from public.gym_clash_nights where id = p_id for update;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_n.status not in ('requested', 'confirmed') then
    raise exception 'That night was cancelled or already declined' using errcode = 'P0001';
  end if;

  update public.gym_clash_nights
     set status = p_decision, admin_note = nullif(btrim(p_note), ''), decided_at = now(), decided_by = auth.uid()
   where id = p_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'clash_night_' || p_decision, 'partner', v_n.partner_id::text,
          jsonb_build_object('id', p_id, 'date', v_n.night_date, 'note', nullif(btrim(p_note), '')));
end;
$$;

revoke all on function public.gym_clash_nights(uuid) from public, anon;
revoke all on function public.gym_book_clash_night(uuid, date, time, date, text) from public, anon;
revoke all on function public.gym_cancel_clash_night(uuid) from public, anon;
revoke all on function public.admin_decide_clash_night(uuid, text, text) from public, anon;
grant execute on function public.gym_clash_nights(uuid) to authenticated;
grant execute on function public.gym_book_clash_night(uuid, date, time, date, text) to authenticated;
grant execute on function public.gym_cancel_clash_night(uuid) to authenticated;
grant execute on function public.admin_decide_clash_night(uuid, text, text) to authenticated;
