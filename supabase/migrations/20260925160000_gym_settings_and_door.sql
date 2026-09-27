-- Gym portal: the gym edits its own details, the front desk runs the door on
-- a finale night, and prizes can be ticked off once handed over.
--
--   gym_profile(partner)                    the editable details, for Settings
--   gym_update_profile(partner, patch)      owner (or admin) changes them, audited
--   gym_event_door(event)                   who is registered, who the geofence
--                                           saw tonight, who has been paid
--   gym_event_checkin(event, user)          pay the finale bonus by hand, capped
--   gym_event_prize_handed(event, rank, on) tick a prize as handed over
--
-- Every function is SECURITY DEFINER behind _gym_role / _event_role, revokes
-- PUBLIC and anon, and writes an admin_audit_log row through _gym_audit.
-- Attendance goes through _live_event_award_attendance, the same idempotent
-- path the clock and the admin door use, so nobody is paid twice.

-- ── The gym's own details ───────────────────────────────────────────────────

create or replace function public.gym_profile(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  p      public.partners;
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into p from public.partners where id = p_partner_id;
  if not found then
    raise exception 'Gym not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id',            p.id,
    'name',          p.name,
    'description',   p.description,
    'address',       p.address,
    'phone',         p.phone,
    'website',       p.website,
    'logo_url',      p.logo_url,
    'logo_bg',       p.logo_bg,
    'image_url',     p.image1_url,
    'opening_hours', p.opening_hours,
    'lat',           nullif(p.locations->0->>'lat', '')::double precision,
    'lng',           nullif(p.locations->0->>'lng', '')::double precision,
    'can_edit',      v_role in ('owner', 'admin')
  );
end;
$$;
revoke all on function public.gym_profile(uuid) from public, anon;
grant execute on function public.gym_profile(uuid) to authenticated;

create or replace function public.gym_update_profile(p_partner_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_key     text;
  v_text    text;
  v_hours   jsonb;
  v_day     text;
  v_slot    jsonb;
  v_changed text[] := '{}';
  v_storage constant text := 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/';
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'Only the owner can change the gym''s details' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Nothing to change' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'description', 'address', 'phone', 'website', 'logo_url', 'logo_bg', 'image_url', 'opening_hours') then
      raise exception 'Can''t change %', v_key using errcode = 'P0001';
    end if;
  end loop;

  if p_patch ? 'name' then
    v_text := btrim(coalesce(p_patch ->> 'name', ''));
    if length(v_text) not between 2 and 60 then
      raise exception 'The name needs 2 to 60 characters' using errcode = 'P0001';
    end if;
    update public.partners set name = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'name');
  end if;

  if p_patch ? 'description' then
    v_text := nullif(btrim(coalesce(p_patch ->> 'description', '')), '');
    if length(coalesce(v_text, '')) > 400 then
      raise exception 'Keep the description under 400 characters' using errcode = 'P0001';
    end if;
    update public.partners set description = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'description');
  end if;

  if p_patch ? 'address' then
    v_text := nullif(btrim(coalesce(p_patch ->> 'address', '')), '');
    if length(coalesce(v_text, '')) > 200 then
      raise exception 'Keep the address under 200 characters' using errcode = 'P0001';
    end if;
    update public.partners set address = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'address');
  end if;

  if p_patch ? 'phone' then
    v_text := nullif(btrim(coalesce(p_patch ->> 'phone', '')), '');
    if length(coalesce(v_text, '')) > 30 then
      raise exception 'That phone number is too long' using errcode = 'P0001';
    end if;
    update public.partners set phone = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'phone');
  end if;

  if p_patch ? 'website' then
    v_text := nullif(btrim(coalesce(p_patch ->> 'website', '')), '');
    if v_text is not null and v_text !~* '^https?://' then
      v_text := 'https://' || v_text;
    end if;
    if length(coalesce(v_text, '')) > 200 then
      raise exception 'That web address is too long' using errcode = 'P0001';
    end if;
    update public.partners set website = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'website');
  end if;

  if p_patch ? 'logo_url' then
    v_text := nullif(btrim(coalesce(p_patch ->> 'logo_url', '')), '');
    if v_text is not null and v_text not like v_storage || '%' then
      raise exception 'Upload the logo here rather than linking to it' using errcode = 'P0001';
    end if;
    update public.partners set logo_url = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'logo_url');
  end if;

  if p_patch ? 'logo_bg' then
    v_text := coalesce(p_patch ->> 'logo_bg', '');
    if v_text not in ('dark', 'black', 'white') then
      raise exception 'The logo background is dark, black or white' using errcode = 'P0001';
    end if;
    update public.partners set logo_bg = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'logo_bg');
  end if;

  if p_patch ? 'image_url' then
    v_text := nullif(btrim(coalesce(p_patch ->> 'image_url', '')), '');
    if v_text is not null and v_text not like v_storage || '%' then
      raise exception 'Upload the photo here rather than linking to it' using errcode = 'P0001';
    end if;
    update public.partners set image1_url = v_text where id = p_partner_id;
    v_changed := array_append(v_changed, 'image_url');
  end if;

  if p_patch ? 'opening_hours' then
    v_hours := p_patch -> 'opening_hours';
    if v_hours is not null and jsonb_typeof(v_hours) = 'null' then
      v_hours := null;
    end if;
    if v_hours is not null then
      if jsonb_typeof(v_hours) <> 'object' then
        raise exception 'Opening hours need a day-by-day list' using errcode = 'P0001';
      end if;
      for v_day in select jsonb_object_keys(v_hours) loop
        if v_day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
          raise exception 'Unknown day %', v_day using errcode = 'P0001';
        end if;
        v_slot := v_hours -> v_day;
        if jsonb_typeof(v_slot) = 'null' then
          continue; -- closed that day
        end if;
        if jsonb_typeof(v_slot) <> 'object'
           or coalesce(v_slot ->> 'open', '')  !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           or coalesce(v_slot ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          raise exception 'Give each day an open and close time, like 06:00 and 22:00' using errcode = 'P0001';
        end if;
      end loop;
    end if;
    update public.partners set opening_hours = v_hours where id = p_partner_id;
    v_changed := array_append(v_changed, 'opening_hours');
  end if;

  if cardinality(v_changed) = 0 then
    raise exception 'Nothing to change' using errcode = 'P0001';
  end if;
  perform public._gym_audit(p_partner_id, 'gym_profile_updated', jsonb_build_object('changed', to_jsonb(v_changed)));
  return public.gym_profile(p_partner_id);
end;
$$;
revoke all on function public.gym_update_profile(uuid, jsonb) from public, anon;
grant execute on function public.gym_update_profile(uuid, jsonb) to authenticated;

-- ── The door on a finale night ──────────────────────────────────────────────
-- Registrants only (the roster is the guest list). "Seen" means the venue
-- geofence had them inside during the doors window, which is what the clock
-- pays on. A hand-marked check-in pays the same bonus through the same
-- idempotent award, so the clock can never pay them again.

create or replace function public.gym_event_door(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_band  record;
  v_rows  jsonb;
  v_seen  integer;
  v_paid  integer;
  v_hand  integer;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into v_band from public._live_event_door_band(v_event);

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',      r.user_id,
           'display_name', r.display_name,
           'username',     r.username,
           'avatar_url',   r.avatar_url,
           'member_id',    r.referral_code,
           'seen',         r.seen,
           'paid_at',      r.awarded_at,
           'paid_source',  r.source)
         order by lower(coalesce(r.display_name, r.username, '')), r.user_id), '[]'::jsonb),
         count(*) filter (where r.seen),
         count(*) filter (where r.awarded_at is not null),
         count(*) filter (where r.source = 'door')
    into v_rows, v_seen, v_paid, v_hand
    from (
      select lp.user_id, p.display_name, p.username, p.avatar_url, p.referral_code,
             a.awarded_at, a.source,
             exists (
               select 1 from public.gym_visits gv
                where gv.user_id = lp.user_id
                  and gv.partner_id = v_event.venue_partner_id
                  and gv.started_at < coalesce(v_band.band_to, now())
                  and coalesce(gv.ended_at, now()) >= v_band.band_from
             ) as seen
        from public.live_event_participants lp
        join public.profiles p on p.id = lp.user_id
        left join public.live_event_attendance_awards a
               on a.event_id = lp.event_id and a.user_id = lp.user_id
       where lp.event_id = v_event.id
         and lp.disqualified_at is null
    ) r;

  return jsonb_build_object(
    'band',         jsonb_build_object('from', v_band.band_from, 'to', v_band.band_to, 'source', v_band.band_source),
    'points',       coalesce(v_event.attendance_bonus_points, 0),
    'auto_paid_at', v_event.attendance_paid_at,
    'registered',   jsonb_array_length(v_rows),
    'seen',         coalesce(v_seen, 0),
    'paid',         coalesce(v_paid, 0),
    'by_hand',      coalesce(v_hand, 0),
    'hand_cap',     greatest(10, coalesce(v_seen, 0)),
    'rows',         v_rows
  );
end;
$$;
revoke all on function public.gym_event_door(uuid) from public, anon;
grant execute on function public.gym_event_door(uuid) to authenticated;

create or replace function public.gym_event_checkin(p_event_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_band  record;
  v_seen  integer;
  v_hand  integer;
  v_open  timestamptz;
  v_close timestamptz;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if coalesce(v_event.attendance_bonus_points, 0) <= 0 then
    raise exception 'This event has no finale bonus, so there is nothing to check in for' using errcode = 'P0001';
  end if;
  if v_event.status not in ('live', 'locked') then
    raise exception 'The door is only open while the event is on' using errcode = 'P0001';
  end if;

  -- Only around the night itself: two hours before doors, six after.
  select * into v_band from public._live_event_door_band(v_event);
  v_open  := v_band.band_from - interval '2 hours';
  v_close := coalesce(v_band.band_to, v_band.band_from + interval '12 hours') + interval '6 hours';
  if now() < v_open or now() > v_close then
    raise exception 'The door opens two hours before the finale and closes six hours after' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.live_event_participants
     where event_id = v_event.id and user_id = p_user_id and disqualified_at is null
  ) then
    raise exception 'They''re not in this event' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.live_event_attendance_awards
     where event_id = v_event.id and user_id = p_user_id
  ) then
    raise exception 'Already checked in' using errcode = 'P0001';
  end if;

  -- Hand-marked check-ins are capped at max(10, however many the geofence saw).
  select count(*) into v_seen
    from public.live_event_participants lp
   where lp.event_id = v_event.id and lp.disqualified_at is null
     and exists (
       select 1 from public.gym_visits gv
        where gv.user_id = lp.user_id
          and gv.partner_id = v_event.venue_partner_id
          and gv.started_at < coalesce(v_band.band_to, now())
          and coalesce(gv.ended_at, now()) >= v_band.band_from
     );
  select count(*) into v_hand
    from public.live_event_attendance_awards
   where event_id = v_event.id and source = 'door';
  if v_hand >= greatest(10, v_seen) then
    raise exception 'That''s the limit for check-ins by hand tonight. Ask POWR if more people are here.' using errcode = 'P0001';
  end if;

  if not public._live_event_award_attendance(v_event, p_user_id, 'door', auth.uid()) then
    raise exception 'Already checked in' using errcode = 'P0001';
  end if;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_checkin',
    jsonb_build_object('event_id', v_event.id, 'user_id', p_user_id, 'points', v_event.attendance_bonus_points));
  return public.gym_event_door(p_event_id);
end;
$$;
revoke all on function public.gym_event_checkin(uuid, uuid) from public, anon;
grant execute on function public.gym_event_checkin(uuid, uuid) to authenticated;

-- ── Prizes, ticked off ──────────────────────────────────────────────────────
-- Only a timestamp goes on the prize (never who ticked it: the event JSON is
-- public in the app). Off again clears it.

create or replace function public.gym_event_prize_handed(p_event_id uuid, p_rank integer, p_handed boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event  public.live_events;
  v_prizes jsonb;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_event.status not in ('revealed', 'settled', 'archived') then
    raise exception 'Prizes are handed over after the reveal' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_event.prizes, '[]'::jsonb)) pz
     where (pz ->> 'rank')::integer = p_rank
  ) then
    raise exception 'No prize with that rank' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(
           case when (pz ->> 'rank')::integer = p_rank
                then (case when coalesce(p_handed, false)
                           then pz || jsonb_build_object('handed_at', now())
                           else pz - 'handed_at' end)
                else pz end
           order by (pz ->> 'rank')::integer), '[]'::jsonb)
    into v_prizes
    from jsonb_array_elements(coalesce(v_event.prizes, '[]'::jsonb)) pz;
  update public.live_events set prizes = v_prizes where id = v_event.id;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_prize_handed',
    jsonb_build_object('event_id', v_event.id, 'rank', p_rank, 'handed', coalesce(p_handed, false)));
  return v_prizes;
end;
$$;
revoke all on function public.gym_event_prize_handed(uuid, integer, boolean) from public, anon;
grant execute on function public.gym_event_prize_handed(uuid, integer, boolean) to authenticated;
