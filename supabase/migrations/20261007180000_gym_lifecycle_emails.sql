-- =============================================================
-- Gym portal emails, batch 1: the moments nobody tells a gym about
-- =============================================================
-- Jamie, 2026-10-07: "plan out which [emails] we would need so it becomes a
-- full package". Then: money emails go to the owner only; trial warnings at
-- 14 and 3 days; the members' notice is "just the push … automatic as the
-- idea will be that we can track when they come back and add this to the
-- emails we send".
--
-- To the gym's team, all sent by send-gym-email (never to members):
--   welcome          someone joined the team            trigger on gym_staff
--   invite_reminder  a setup link unused after 5 days   daily run
--                    (a second link for the same invite; both work, the
--                    first one used burns the invite)
--   trial_ending     14 and 3 days before the trial ends, owners only, and
--                    only when the package loses something   daily run
--   trial_ended      once it has, owners only           daily run
--   package_changed  POWR set the package               trigger, owners only
--   support_reply    POWR answered a gym_help ticket    trigger, to the writer
--   clash_night      POWR confirmed or declined a night trigger, owners + asker
--
-- To members, one push, gym_on_powr: the first time a gym's portal is on
-- (30 minutes after, between 10:00 and 20:00 gym time), the people the gym
-- can now see in Retention (members + anyone checked in within 180 days,
-- minus anyone who switched visits off) hear that the gym is on POWR and
-- where the switch is. Who was told, and how their visits stood that day,
-- is kept in gym_member_notices; get_gym_notice_returns() counts who has
-- been back since, for the Monday recap.
--
-- Nothing reaches a gym whose portal is off: every sender checks enabled,
-- suspended_at and partners.active, the same conditions as _gym_role().
-- No existing function is re-stated here.

-- ── Sent-once log for the scheduled emails ──────────────────────────────────
create table if not exists public.gym_email_log (
  partner_id uuid not null references public.partners(id) on delete cascade,
  kind       text not null,
  ref        text not null,
  sent_at    timestamptz not null default now(),
  detail     jsonb,
  primary key (partner_id, kind, ref)
);
alter table public.gym_email_log enable row level security;
revoke all on table public.gym_email_log from public, anon, authenticated;
comment on table public.gym_email_log is
  'Scheduled gym emails already sent (send-gym-email claims the row, then sends; a failed send frees it). ref = what it was about, e.g. "d14:2026-12-24" for a trial warning.';

-- ── Invite reminders: a second link for the same invite ────────────────────
-- Only token hashes are stored, so the reminder cannot repeat the first link.
-- It mints a second one on the same row: either works, and whichever is used
-- first burns the invite (manage-gym-staff looks up both).
alter table public.gym_staff_invites
  add column if not exists reminder_token_hash text unique,
  add column if not exists reminded_at         timestamptz;
comment on column public.gym_staff_invites.reminder_token_hash is
  'sha256 of the second setup link sent by the 5-day reminder (send-gym-email). Valid alongside token_hash until the invite is used, revoked or expires.';

-- ── The members' notice ─────────────────────────────────────────────────────
alter table public.gym_portal_settings
  add column if not exists member_notice_at    timestamptz,
  add column if not exists member_notice_count integer;
comment on column public.gym_portal_settings.member_notice_at is
  'When POWR told the gym''s people it is on POWR (push gym_on_powr, once per gym). Null = still to go: _gym_member_notice_dispatch sends it.';
comment on column public.gym_portal_settings.member_notice_count is
  'How many people the notice went to. Null on portals switched on before the notice existed (no push was sent).';

-- Portals already on (POWR's own gym, 10-07) were switched on before this
-- existed: mark them done, with no push.
update public.gym_portal_settings
   set member_notice_at = now()
 where enabled and member_notice_at is null;

create table if not exists public.gym_member_notices (
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  is_member  boolean not null,
  status     text not null,
  last_visit date,
  primary key (partner_id, user_id)
);
alter table public.gym_member_notices enable row level security;
revoke all on table public.gym_member_notices from public, anon, authenticated;
comment on table public.gym_member_notices is
  'Who heard (push gym_on_powr) that their gym is on POWR, and how their visits there stood that day (_gym_retention_people status, last visit). get_gym_notice_returns counts who has been back since.';

insert into public.notification_config (type, enabled, category, class, daily_cap, description)
select 'gym_on_powr', true, 'social', 'social', 1,
       'Once per gym, automatically: the first time its portal is switched on, the people it can now see (members + anyone checked in within 180 days, minus visit opt-outs) hear it is on POWR and where to switch visits off. Follows the Announcements preference.'
where not exists (select 1 from public.notification_config where type = 'gym_on_powr');

-- Sends the notice for every gym that is due. Due = portal on (and not
-- suspended, partner active) for 30 minutes or more, notice not yet sent,
-- and between 10:00 and 20:00 at the gym. The cron runs it every 15 minutes.
--   p_partner_id  one gym only, now, whatever the time (admins, from SQL)
--   p_dry_run     who it would reach, sends nothing, marks nothing
--   p_only_user   a test: one push to one person, recorded nowhere
-- "Reach" is the honest number: a phone with POWR's notifications on and
-- Announcements not switched off (the same rule as gym_event_push_status).
create or replace function public._gym_member_notice_dispatch(
  p_partner_id uuid default null, p_dry_run boolean default false, p_only_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  g        record;
  v_tz     text;
  v_hour   integer;
  v_token  text;
  v_people jsonb;
  v_target jsonb;
  v_n      integer;
  v_batch  jsonb;
  v_i      integer;
  v_out    jsonb := '[]'::jsonb;
begin
  if p_only_user is not null and p_partner_id is null then
    raise exception 'A test push needs the gym (p_partner_id)' using errcode = 'P0001';
  end if;
  if not coalesce((select c.enabled from public.notification_config c where c.type = 'gym_on_powr'), false)
     and not p_dry_run then
    return jsonb_build_object('skipped', 'switched_off');
  end if;

  for g in
    select s.partner_id, p.name,
           nullif(p.locations->0->>'lat', '')::double precision as lat,
           nullif(p.locations->0->>'lng', '')::double precision as lng
      from public.gym_portal_settings s
      join public.partners p on p.id = s.partner_id
     where s.enabled and s.suspended_at is null and p.active
       and (p_partner_id is null or s.partner_id = p_partner_id)
       and (p_only_user is not null or s.member_notice_at is null)
       and (p_partner_id is not null or greatest(s.created_at, s.updated_at) < now() - interval '30 minutes')
  loop
    v_tz := public._gym_tz(g.partner_id);
    v_hour := extract(hour from now() at time zone v_tz)::integer;
    if p_partner_id is null and (v_hour < 10 or v_hour >= 20) then
      continue;
    end if;

    v_target := jsonb_build_object(
      'type', 'gym_on_powr',
      'payload', jsonb_build_object('partner_id', g.partner_id, 'gym_name', g.name, 'lat', g.lat, 'lng', g.lng));

    if p_only_user is not null then
      v_people := jsonb_build_array(jsonb_build_object('user_id', p_only_user));
    else
      -- Assigned, not SELECT INTO: plpgsql will not take INTO on a WITH query.
      v_people := (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', r.user_id, 'is_member', r.is_member, 'status', r.status, 'last_visit', r.last_visit)), '[]'::jsonb)
          from public._gym_retention_people(g.partner_id) r
         where exists (select 1 from public.user_push_tokens t where t.user_id = r.user_id)
           and coalesce((select np.announcements from public.notification_preferences np
                          where np.user_id = r.user_id), true)
      );
    end if;
    v_n := jsonb_array_length(v_people);
    v_out := v_out || jsonb_build_object('partner_id', g.partner_id, 'gym', g.name, 'people', v_n,
      'away', (select count(*) from jsonb_array_elements(v_people) x
                where x->>'status' in ('slipping', 'drifting', 'lapsed', 'unseen')));
    if p_dry_run then
      continue;
    end if;

    if v_n > 0 then
      v_token := coalesce(v_token, (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token'));
      v_i := 0;
      while v_i < v_n loop
        v_batch := (
          select jsonb_agg(v_target || jsonb_build_object('target_user_id', x->>'user_id'))
            from jsonb_array_elements(v_people) with ordinality t(x, k)
           where t.k > v_i and t.k <= v_i + 100
        );
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
          body := jsonb_build_object('targets', v_batch),
          timeout_milliseconds := 60000
        );
        v_i := v_i + 100;
      end loop;
    end if;

    if p_only_user is not null then
      continue;
    end if;

    insert into public.gym_member_notices (partner_id, user_id, is_member, status, last_visit)
    select g.partner_id, (x->>'user_id')::uuid, (x->>'is_member')::boolean, x->>'status', (x->>'last_visit')::date
      from jsonb_array_elements(v_people) x
    on conflict (partner_id, user_id) do nothing;

    update public.gym_portal_settings
       set member_notice_at = now(), member_notice_count = v_n
     where partner_id = g.partner_id;

    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'gym_member_notice_sent', 'partner', g.partner_id::text,
            jsonb_build_object('by', 'powr', 'people', v_n));
  end loop;
  return v_out;
end;
$$;
revoke all on function public._gym_member_notice_dispatch(uuid, boolean, uuid) from public, anon, authenticated;

-- Who has been back since the notice. "Away" = slipping, drifting or lapsed
-- against their own usual gap that day, or not seen there in 180 days
-- (unseen). "Back" = a POWR check-in at the gym since. p_from / p_to also
-- count first returns inside a window (the recap's week). Anyone who has
-- since switched their visits off is left out. Null = no notice was sent.
create or replace function public.get_gym_notice_returns(
  p_partner_id uuid, p_from timestamptz default null, p_to timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select member_notice_at as at, member_notice_count as told
      from public.gym_portal_settings where partner_id = p_partner_id
  ),
  n as (
    select m.status,
           m.status in ('slipping', 'drifting', 'lapsed') as away,
           m.status = 'unseen' as unseen,
           (select min(a.started_at)
              from public.activity_sessions a
             where a.user_id = m.user_id and a.partner_id = p_partner_id
               and a.verification::text = 'geofence'
               and not coalesce(a.flagged, false)
               and a.type::text <> 'sleep'
               and a.started_at > m.sent_at) as back_at
      from public.gym_member_notices m
     where m.partner_id = p_partner_id
       and not exists (select 1 from public.gym_visit_optouts o where o.user_id = m.user_id)
  )
  select case when s.at is null or s.told is null then null else jsonb_build_object(
           'sent_at',       s.at,
           'told',          s.told,
           'away',          (select count(*) from n where n.away),
           'unseen',        (select count(*) from n where n.unseen),
           'back',          (select count(*) from n where n.away and n.back_at is not null),
           'unseen_back',   (select count(*) from n where n.unseen and n.back_at is not null),
           'back_in',       (select count(*) from n where n.away and n.back_at >= p_from and n.back_at < p_to),
           'unseen_back_in',(select count(*) from n where n.unseen and n.back_at >= p_from and n.back_at < p_to)
         ) end
    from s
$$;
revoke all on function public.get_gym_notice_returns(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ── What every gym email needs to know about the gym ───────────────────────
-- Service role only: it reads the team's email addresses.
create or replace function public.get_gym_mail_context(p_partner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'gym', jsonb_build_object(
      'id', p.id, 'name', p.name, 'logo_url', p.logo_url, 'logo_bg', p.logo_bg,
      'tz', public._gym_tz(p.id)),
    'live',             coalesce(s.enabled, false) and s.suspended_at is null and p.active,
    'package',          s.package,
    'billing',          s.billing,
    'trial_ends_at',    s.trial_ends_at,
    'on_trial',         coalesce(s.trial_ends_at > now(), false),
    'member_notice_at', s.member_notice_at,
    'member_notice_count', s.member_notice_count,
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', st.user_id,
               'role',    st.role,
               'email',   lower(u.email),
               'name',    coalesce(nullif(btrim(pr.display_name), ''), nullif(btrim(u.raw_user_meta_data->>'full_name'), '')))
             order by st.created_at)
        from public.gym_staff st
        join auth.users u on u.id = st.user_id
        left join public.profiles pr on pr.id = st.user_id
       where st.partner_id = p.id
         and u.email is not null
         and u.deleted_at is null
         and (u.banned_until is null or u.banned_until < now())
    ), '[]'::jsonb)
  )
    from public.partners p
    left join public.gym_portal_settings s on s.partner_id = p.id
   where p.id = p_partner_id
$$;
revoke all on function public.get_gym_mail_context(uuid) from public, anon, authenticated;

-- ── The daily run: trial warnings and invite reminders that are due ────────
-- Trial stages, by days left on the gym's own calendar:
--   14 … 4  trial_ending, ref 'd14:<end date>'
--    3 … 1  trial_ending, ref 'd3:<end date>'
--   ended in the last 7 days  trial_ended, ref '<end date>'
-- A moved end date is a new ref, so an extended trial warns again. Gyms whose
-- package already includes everything the trial does (Clash Pro, Founding
-- Pro) lose nothing and get none of these.
create or replace function public.get_gym_lifecycle_mail()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select s.*, p.name, public._gym_tz(s.partner_id) as tz
      from public.gym_portal_settings s
      join public.partners p on p.id = s.partner_id
     where s.enabled and s.suspended_at is null and p.active
  ),
  trial as (
    select l.partner_id, l.name, l.tz, l.package, l.trial_ends_at,
           (l.trial_ends_at at time zone l.tz)::date as end_day,
           (l.trial_ends_at at time zone l.tz)::date - (now() at time zone l.tz)::date as days_left,
           (select coalesce(jsonb_agg(f.key order by f.key), '[]'::jsonb)
              from jsonb_each_text(public._gym_features(2)) f
             where f.value = 'true'
               and coalesce((public._gym_features(public._gym_package_level(l.package)) ->> f.key)::boolean, false) = false
           ) as lost
      from live l
     where l.trial_ends_at is not null
  ),
  due as (
    select t.*,
           case when t.trial_ends_at <= now() then 'trial_ended' else 'trial_ending' end as kind,
           case when t.trial_ends_at <= now() then t.end_day::text
                when t.days_left <= 3 then 'd3:' || t.end_day
                else 'd14:' || t.end_day end as ref
      from trial t
     where jsonb_array_length(t.lost) > 0
       and ((t.trial_ends_at > now() and t.days_left between 1 and 14)
         or (t.trial_ends_at <= now() and t.trial_ends_at > now() - interval '7 days'))
  )
  select jsonb_build_object(
    'trial', coalesce((
      select jsonb_agg(jsonb_build_object(
               'partner_id', d.partner_id, 'gym', d.name, 'tz', d.tz, 'kind', d.kind, 'ref', d.ref,
               'package', d.package, 'trial_ends_at', d.trial_ends_at,
               'days_left', greatest(d.days_left, 0), 'lost', d.lost,
               'owners', coalesce((
                 select jsonb_agg(distinct lower(u.email))
                   from public.gym_staff st join auth.users u on u.id = st.user_id
                  where st.partner_id = d.partner_id and st.role = 'owner'
                    and u.email is not null and u.deleted_at is null
                    and (u.banned_until is null or u.banned_until < now())), '[]'::jsonb)))
        from due d
       where not exists (select 1 from public.gym_email_log e
                          where e.partner_id = d.partner_id and e.kind = d.kind and e.ref = d.ref)
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invite_id', i.id, 'partner_id', i.partner_id, 'gym', l.name, 'tz', l.tz,
               'logo_url', p.logo_url, 'role', i.role, 'email', lower(i.email),
               'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at)
        from public.gym_staff_invites i
        join live l on l.partner_id = i.partner_id
        join public.partners p on p.id = i.partner_id
       where i.status = 'invited'
         and i.email is not null
         and i.reminded_at is null
         and i.created_at <= now() - interval '5 days'
         and i.expires_at > now() + interval '1 day'
         -- Already on the team (joined through another link): nothing to chase.
         and not exists (select 1 from public.gym_staff st join auth.users u on u.id = st.user_id
                          where st.partner_id = i.partner_id and lower(u.email) = lower(i.email))
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.get_gym_lifecycle_mail() from public, anon, authenticated;

-- ── Ask send-gym-email to write (after commit; never blocks the change) ────
create or replace function public._gym_mail(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-gym-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := p_body,
    timeout_milliseconds := 8000
  );
exception when others then
  raise warning '[_gym_mail] %', sqlerrm;
end;
$$;
revoke all on function public._gym_mail(jsonb) from public, anon, authenticated;

create or replace function public._gym_lifecycle_mail_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'gym_staff' then
    perform public._gym_mail(jsonb_build_object('kind', 'welcome', 'partner_id', new.partner_id, 'user_id', new.user_id));
  elsif tg_table_name = 'gym_portal_settings' then
    perform public._gym_mail(jsonb_build_object('kind', 'package_changed', 'partner_id', new.partner_id,
                                                'from', old.package, 'to', new.package));
  elsif tg_table_name = 'support_tickets' then
    perform public._gym_mail(jsonb_build_object('kind', 'support_reply', 'ticket_id', new.id,
                                                'updated', coalesce(btrim(old.admin_reply), '') <> ''));
  elsif tg_table_name = 'gym_clash_nights' then
    perform public._gym_mail(jsonb_build_object('kind', 'clash_night', 'night_id', new.id, 'was', old.status));
  end if;
  return null;
exception when others then
  raise warning '[_gym_lifecycle_mail_trigger] %', sqlerrm;
  return null;
end;
$$;
revoke all on function public._gym_lifecycle_mail_trigger() from public, anon, authenticated;

drop trigger if exists gym_staff_welcome_mail on public.gym_staff;
create trigger gym_staff_welcome_mail
  after insert on public.gym_staff
  for each row execute function public._gym_lifecycle_mail_trigger();

drop trigger if exists gym_portal_settings_package_mail on public.gym_portal_settings;
create trigger gym_portal_settings_package_mail
  after update of package on public.gym_portal_settings
  for each row when (new.package is distinct from old.package)
  execute function public._gym_lifecycle_mail_trigger();

drop trigger if exists support_tickets_gym_reply_mail on public.support_tickets;
create trigger support_tickets_gym_reply_mail
  after update of admin_reply on public.support_tickets
  for each row when (new.category = 'gym_help' and new.gym_partner_id is not null
                     and new.admin_reply is distinct from old.admin_reply
                     and btrim(coalesce(new.admin_reply, '')) <> '')
  execute function public._gym_lifecycle_mail_trigger();

drop trigger if exists gym_clash_nights_decision_mail on public.gym_clash_nights;
create trigger gym_clash_nights_decision_mail
  after update of status on public.gym_clash_nights
  for each row when (new.status is distinct from old.status and new.status in ('confirmed', 'declined'))
  execute function public._gym_lifecycle_mail_trigger();

-- ── Schedules ───────────────────────────────────────────────────────────────
do $job$
begin
  perform cron.unschedule('gym-member-notice');
exception when others then
  null;
end
$job$;

select cron.schedule(
  'gym-member-notice',
  '*/15 * * * *',
  $cron$ select public._gym_member_notice_dispatch() $cron$
);

do $job$
begin
  perform cron.unschedule('gym-lifecycle-email');
exception when others then
  null;
end
$job$;

-- 09:45 UTC daily: after the member weekly (Mon 08:00), the re-engagement
-- run (09:00) and the brand setup reminder (09:30), so it never shares the
-- Mailgun window with them.
select cron.schedule(
  'gym-lifecycle-email',
  '45 9 * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-gym-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{"kind":"lifecycle"}'::jsonb
  )
  $cron$
);
