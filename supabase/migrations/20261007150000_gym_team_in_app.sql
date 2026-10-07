-- Gym portal: the gym's team on its page in the app. Personal trainers,
-- coaches and staff, each with a photo, a role, a short bio, what they
-- specialise in and a booking link, shown under the gym on Discover.
--
--   trainers.role / profile_url / booking_url / updated_at
--       profile_url and booking_url were written by 20260416000001, which is
--       recorded in schema_migrations but never reached the table, so the
--       admin trainer editor (it sends both) has been failing to save, and
--       the app's Book Session / View Profile buttons never showed. role is
--       new: null means a personal trainer, which is what every row was.
--
--   gym_team(partner)                      everyone, hidden ones too, in order
--   gym_save_team_member(partner, id, f)   add (id null) or change one, audited
--   gym_delete_team_member(partner, id)    take one off, audited
--   gym_order_team(partner, ids[])         the order members see them in
--
-- Same rules as gym_profile / gym_update_profile: SECURITY DEFINER behind
-- _gym_role, owners (and POWR admins) change things, staff can look, PUBLIC
-- and anon revoked. The table's RLS is untouched: members keep reading
-- active rows at active gyms; staff get no table access of their own.

alter table public.trainers
  add column if not exists profile_url text,
  add column if not exists booking_url text,
  add column if not exists role        text,
  add column if not exists updated_at  timestamptz not null default now();

-- ── Read ────────────────────────────────────────────────────────────────────

create or replace function public.gym_team(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_edit', v_role in ('owner', 'admin'),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',          t.id,
               'name',        t.name,
               'role',        t.role,
               'photo_url',   t.photo_url,
               'experience',  t.experience,
               'specialties', coalesce(to_jsonb(t.specialties), '[]'::jsonb),
               'bio',         t.bio,
               'booking_url', t.booking_url,
               'profile_url', t.profile_url,
               'active',      t.active,
               'sort_order',  t.sort_order
             ) order by t.sort_order, t.created_at)
        from public.trainers t
       where t.partner_id = p_partner_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.gym_team(uuid) from public, anon;
grant execute on function public.gym_team(uuid) to authenticated;

-- ── A link a member taps: http(s) only, https added when it's left off ──────

create or replace function public._gym_team_link(p_value text, p_what text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then
    return null;
  end if;
  if v !~* '^[a-z][a-z0-9+.-]*:' then
    v := 'https://' || v;
  end if;
  if v !~* '^https?://[^\s/$.?#][^\s]*$' then
    raise exception 'The % needs to be a web address, like calendly.com/yourname', p_what using errcode = 'P0001';
  end if;
  if length(v) > 300 then
    raise exception 'That % is too long', p_what using errcode = 'P0001';
  end if;
  return v;
end;
$$;
revoke all on function public._gym_team_link(text, text) from public, anon, authenticated;

-- ── Add or change one ───────────────────────────────────────────────────────

create or replace function public.gym_save_team_member(p_partner_id uuid, p_member_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_key     text;
  v_text    text;
  v_item    text;
  v_list    text[];
  t         public.trainers;
  v_new     boolean := p_member_id is null;
  v_changed text[] := '{}';
  v_storage constant text := 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/';
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'Only the owner can change who shows in the app' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Nothing to change' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('name', 'role', 'photo_url', 'experience', 'specialties', 'bio', 'booking_url', 'profile_url', 'active') then
      raise exception 'Can''t change %', v_key using errcode = 'P0001';
    end if;
  end loop;

  if v_new then
    if not (p_fields ? 'name') then
      raise exception 'Give them a name' using errcode = 'P0001';
    end if;
    if (select count(*) from public.trainers where partner_id = p_partner_id) >= 40 then
      raise exception 'That''s 40 people already. Take someone off first.' using errcode = 'P0001';
    end if;
    t.id := gen_random_uuid();
    t.partner_id := p_partner_id;
    t.active := true;
    t.sort_order := coalesce((select max(sort_order) + 1 from public.trainers where partner_id = p_partner_id), 0);
  else
    select * into t from public.trainers where id = p_member_id and partner_id = p_partner_id for update;
    if not found then
      raise exception 'They''re not on your team any more' using errcode = 'P0002';
    end if;
  end if;

  if p_fields ? 'name' then
    v_text := btrim(coalesce(p_fields ->> 'name', ''));
    if length(v_text) not between 2 and 60 then
      raise exception 'The name needs 2 to 60 characters' using errcode = 'P0001';
    end if;
    t.name := v_text;
    v_changed := array_append(v_changed, 'name');
  end if;

  if p_fields ? 'role' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'role', '')), '');
    if length(coalesce(v_text, '')) > 30 then
      raise exception 'Keep the role under 30 characters' using errcode = 'P0001';
    end if;
    t.role := v_text;
    v_changed := array_append(v_changed, 'role');
  end if;

  if p_fields ? 'experience' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'experience', '')), '');
    if length(coalesce(v_text, '')) > 40 then
      raise exception 'Keep the experience short, like 8 years' using errcode = 'P0001';
    end if;
    t.experience := v_text;
    v_changed := array_append(v_changed, 'experience');
  end if;

  if p_fields ? 'bio' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'bio', '')), '');
    if length(coalesce(v_text, '')) > 500 then
      raise exception 'Keep the bio under 500 characters' using errcode = 'P0001';
    end if;
    t.bio := v_text;
    v_changed := array_append(v_changed, 'bio');
  end if;

  if p_fields ? 'specialties' then
    if jsonb_typeof(p_fields -> 'specialties') not in ('array', 'null') then
      raise exception 'Specialties are a list' using errcode = 'P0001';
    end if;
    v_list := '{}';
    for v_item in select btrim(x) from jsonb_array_elements_text(coalesce(nullif(p_fields -> 'specialties', 'null'::jsonb), '[]'::jsonb)) x loop
      continue when v_item = '' or lower(v_item) = any (select lower(s) from unnest(v_list) s);
      if length(v_item) > 24 then
        raise exception 'Keep each specialty under 24 characters' using errcode = 'P0001';
      end if;
      v_list := array_append(v_list, v_item);
    end loop;
    if cardinality(v_list) > 6 then
      raise exception 'Pick up to 6 specialties' using errcode = 'P0001';
    end if;
    t.specialties := nullif(v_list, '{}');
    v_changed := array_append(v_changed, 'specialties');
  end if;

  if p_fields ? 'photo_url' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'photo_url', '')), '');
    if v_text is not null
       and v_text not like v_storage || 'reward-images/%'
       and v_text not like v_storage || 'trainer-photos/%' then
      raise exception 'Upload the photo here rather than linking to it' using errcode = 'P0001';
    end if;
    t.photo_url := v_text;
    v_changed := array_append(v_changed, 'photo_url');
  end if;

  if p_fields ? 'booking_url' then
    t.booking_url := public._gym_team_link(p_fields ->> 'booking_url', 'booking link');
    v_changed := array_append(v_changed, 'booking_url');
  end if;

  if p_fields ? 'profile_url' then
    t.profile_url := public._gym_team_link(p_fields ->> 'profile_url', 'profile link');
    v_changed := array_append(v_changed, 'profile_url');
  end if;

  if p_fields ? 'active' then
    if jsonb_typeof(p_fields -> 'active') <> 'boolean' then
      raise exception 'Shown in the app is yes or no' using errcode = 'P0001';
    end if;
    t.active := (p_fields ->> 'active')::boolean;
    v_changed := array_append(v_changed, 'active');
  end if;

  if cardinality(v_changed) = 0 then
    raise exception 'Nothing to change' using errcode = 'P0001';
  end if;
  t.updated_at := now();

  if v_new then
    t.created_at := now();
    insert into public.trainers select t.*;
  else
    update public.trainers
       set name = t.name, role = t.role, photo_url = t.photo_url, experience = t.experience,
           specialties = t.specialties, bio = t.bio, booking_url = t.booking_url,
           profile_url = t.profile_url, active = t.active, updated_at = t.updated_at
     where id = t.id;
  end if;

  perform public._gym_audit(p_partner_id, case when v_new then 'gym_team_member_added' else 'gym_team_member_updated' end,
    jsonb_build_object('member_id', t.id, 'name', t.name, 'changed', to_jsonb(v_changed)));
  return public.gym_team(p_partner_id) || jsonb_build_object('saved_id', t.id);
end;
$$;
revoke all on function public.gym_save_team_member(uuid, uuid, jsonb) from public, anon;
grant execute on function public.gym_save_team_member(uuid, uuid, jsonb) to authenticated;

-- ── Take one off ────────────────────────────────────────────────────────────

create or replace function public.gym_delete_team_member(p_partner_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'Only the owner can change who shows in the app' using errcode = '42501';
  end if;
  delete from public.trainers where id = p_member_id and partner_id = p_partner_id returning name into v_name;
  if v_name is null then
    raise exception 'They''re not on your team any more' using errcode = 'P0002';
  end if;
  perform public._gym_audit(p_partner_id, 'gym_team_member_removed', jsonb_build_object('member_id', p_member_id, 'name', v_name));
  return public.gym_team(p_partner_id);
end;
$$;
revoke all on function public.gym_delete_team_member(uuid, uuid) from public, anon;
grant execute on function public.gym_delete_team_member(uuid, uuid) to authenticated;

-- ── The order members see them in ───────────────────────────────────────────
-- Ids not listed (or not this gym's) are left where they are, after the rest.

create or replace function public.gym_order_team(p_partner_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_n    int := coalesce(cardinality(p_ids), 0);
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'Only the owner can change who shows in the app' using errcode = '42501';
  end if;
  if v_n = 0 or v_n > 40 then
    raise exception 'Nothing to order' using errcode = 'P0001';
  end if;
  update public.trainers t
     set sort_order = case when o.i is null then v_n + t.sort_order else o.i - 1 end,
         updated_at = now()
    from public.trainers x
    left join unnest(p_ids) with ordinality as o(id, i) on o.id = x.id
   where t.id = x.id
     and t.partner_id = p_partner_id;
  perform public._gym_audit(p_partner_id, 'gym_team_reordered', jsonb_build_object('count', v_n));
  return public.gym_team(p_partner_id);
end;
$$;
revoke all on function public.gym_order_team(uuid, uuid[]) from public, anon;
grant execute on function public.gym_order_team(uuid, uuid[]) to authenticated;
