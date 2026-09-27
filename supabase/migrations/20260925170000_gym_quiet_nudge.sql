-- The quiet-member nudge (Clash Pro). The Members page names who has gone
-- quiet; this lets the gym reach out. One push, POWR's words (never the
-- gym's), to the members who share their activity with the gym and have gone
-- quiet, on the gym's press. It follows the Announcements preference (send-
-- push maps the type), goes to a member at most once a fortnight, and to a
-- gym's people at most once a day. One send-push batch, capped.

-- ── The push type ───────────────────────────────────────────────────────────
insert into public.notification_config (type, enabled, category, class, daily_cap, description)
select 'gym_quiet_nudge', true, 'social', 'social', 1,
       'A gym''s "your spot''s still here", on its press from the portal (Clash Pro), to members who share activity with it and have gone quiet. POWR''s words; follows the Announcements preference; once per member per fortnight.'
where not exists (select 1 from public.notification_config where type = 'gym_quiet_nudge');

-- ── Who was nudged when: the fortnight rule, kept by the sender itself ──────
create table if not exists public.gym_quiet_nudges (
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  sent_by    uuid
);
create index if not exists gym_quiet_nudges_partner_user_idx on public.gym_quiet_nudges (partner_id, user_id, sent_at desc);
alter table public.gym_quiet_nudges enable row level security;
-- Nobody reads it from a client; the function writes it as definer.
revoke all on table public.gym_quiet_nudges from public, anon, authenticated;
comment on table public.gym_quiet_nudges is 'Which members a gym nudged for going quiet, and when: gym_nudge_quiet sends a member at most once a fortnight.';

-- ── The nudge ───────────────────────────────────────────────────────────────
create or replace function public.gym_nudge_quiet(p_partner_id uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text := public._gym_role(p_partner_id);
  v_gym     public.partners;
  v_tz      text;
  v_token   text;
  v_res     jsonb;
  v_targets jsonb;
  v_n       integer := 0;
  v_cooling integer := 0;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'people');
  select * into v_gym from public.partners where id = p_partner_id;
  v_tz := public._gym_tz(p_partner_id);

  if not p_dry_run and exists (
    select 1 from public.gym_quiet_nudges n
     where n.partner_id = p_partner_id
       and (n.sent_at at time zone v_tz)::date = (now() at time zone v_tz)::date
  ) then
    raise exception 'Already sent today. It can go again tomorrow' using errcode = 'P0001';
  end if;

  -- The same "gone quiet" as the Members page: members who share their
  -- activity with this gym and chose it, with at least six active days in
  -- weeks 3–8 and none in the last two. Assigned, not SELECT INTO: plpgsql
  -- will not take INTO on a WITH query.
  v_res := (
    with c as (
      select c.user_id
        from public.gym_activity_consents c
        join public.profiles p on p.id = c.user_id
       where c.partner_id = p_partner_id
         and p.preferred_gym_id = p_partner_id
    ),
    s as (
      select * from (
        select s.user_id, s.type::text as type, s.started_at,
               greatest(0, coalesce(s.duration_sec, extract(epoch from (s.ended_at - s.started_at))::integer, 0)) as dur,
               (s.started_at at time zone v_tz)::date as d
          from public.activity_sessions s
          join c on c.user_id = s.user_id
         where s.type::text <> 'sleep'
           and not coalesce(s.flagged, false)
           and s.started_at >= now() - interval '56 days'
      ) x
      where not (type = 'walking' and dur < 300)
    ),
    st as (
      select c.user_id,
             count(distinct s.d) filter (where s.started_at >= now() - interval '14 days') as recent,
             count(distinct s.d) filter (where s.started_at <  now() - interval '14 days') as base,
             max(s.started_at) as last_active
        from c left join s on s.user_id = c.user_id
       group by c.user_id
    ),
    quiet as (
      select st.user_id, st.last_active,
             exists (select 1 from public.gym_quiet_nudges n
                      where n.partner_id = p_partner_id and n.user_id = st.user_id
                        and n.sent_at > now() - interval '14 days') as cooling
        from st
       where st.base >= 6 and st.recent = 0
       order by st.last_active nulls last
       limit 200
    )
    select jsonb_build_object(
      'targets', coalesce(jsonb_agg(jsonb_build_object(
                   'target_user_id', q.user_id,
                   'type', 'gym_quiet_nudge',
                   'payload', jsonb_build_object(
                     'partner_id', p_partner_id,
                     'gym_name',   v_gym.name,
                     'lat',        nullif(v_gym.locations->0->>'lat', '')::double precision,
                     'lng',        nullif(v_gym.locations->0->>'lng', '')::double precision,
                     'weeks',      case when q.last_active is null then null
                                        else floor(extract(epoch from (now() - q.last_active)) / 604800)::integer end
                   )) order by q.last_active nulls last) filter (where not q.cooling), '[]'::jsonb),
      'n',       count(*) filter (where not q.cooling),
      'cooling', count(*) filter (where q.cooling))
      from quiet q
  );
  v_targets := v_res -> 'targets';
  v_n       := coalesce((v_res ->> 'n')::integer, 0);
  v_cooling := coalesce((v_res ->> 'cooling')::integer, 0);

  if p_dry_run or v_n = 0 then
    return jsonb_build_object('recipients', v_n, 'cooling', v_cooling, 'sent', false);
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'shared_resolve_token';
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
    body := jsonb_build_object('targets', v_targets),
    timeout_milliseconds := 8000
  );
  insert into public.gym_quiet_nudges (partner_id, user_id, sent_by)
  select p_partner_id, (t ->> 'target_user_id')::uuid, auth.uid()
    from jsonb_array_elements(v_targets) t;
  perform public._gym_audit(p_partner_id, 'gym_quiet_nudge_sent',
    jsonb_build_object('partner_id', p_partner_id, 'recipients', v_n, 'cooling', v_cooling));
  return jsonb_build_object('recipients', v_n, 'cooling', v_cooling, 'sent', true);
end;
$$;
revoke all on function public.gym_nudge_quiet(uuid, boolean) from public, anon;
grant execute on function public.gym_nudge_quiet(uuid, boolean) to authenticated;
