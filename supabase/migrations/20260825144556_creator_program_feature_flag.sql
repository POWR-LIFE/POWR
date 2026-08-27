-- =============================================================
-- CREATOR PROGRAMME — master switch
-- =============================================================
-- Jamie, 2026-08-25: "a setting in admin config that turns the
-- creator option on and off so we can turn it on when we're ready."
-- Mirrors partner_placements_enabled. Default OFF.
--
-- OFF means: creator codes resolve as ordinary member invites (a
-- creator who is also a member still gets member-tier attribution
-- — nothing is lost), /join links go straight to the app with no
-- ref and log nothing, the /creator portal is closed to everyone
-- but admins, and event bonuses don't pay. Admin pages under
-- Creators keep working so it can all be set up first.
-- =============================================================

insert into public.system_config (key, value, description)
values (
  'creator_program_enabled',
  'false',
  'Master switch for the creator programme. Off: creator codes act as plain member invites, /join links go to the app with no attribution, the /creator portal is closed to non-admins, no event bonuses. Admin setup pages keep working.'
)
on conflict (key) do nothing;

-- system_config SELECT is otherwise admin-only; expose just this flag so
-- the portal can decide whether to open.
drop policy if exists "Authenticated can read creator programme flag" on public.system_config;
create policy "Authenticated can read creator programme flag"
  on public.system_config for select
  to authenticated
  using (key = 'creator_program_enabled');

create or replace function public.creator_program_enabled()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select value = 'true' from public.system_config where key = 'creator_program_enabled'),
    false)
$$;
revoke all on function public.creator_program_enabled() from public, anon;
grant execute on function public.creator_program_enabled() to authenticated;

-- ── Code resolution: the creator alias only wins while the programme is on ──
create or replace function public.resolve_invite_code(p_code text)
returns table (kind text, referrer_id uuid, creator_id uuid, member_user_id uuid)
language sql stable security definer set search_path = public
as $$
  with norm as (select upper(trim(p_code)) as c),
       on_ as (select public.creator_program_enabled() as v)
  select 'creator'::text, null::uuid, cr.id, cr.member_user_id
    from public.creators cr, norm, on_
   where on_.v and cr.code = norm.c and cr.status = 'active'
  union all
  select 'member'::text, p.id, null::uuid, p.id
    from public.profiles p, norm, on_
   where p.referral_code = norm.c
     and not (on_.v and exists (select 1 from public.creators c2 where c2.code = norm.c and c2.status = 'active'))
  limit 1;
$$;
revoke all on function public.resolve_invite_code(text) from public, anon, authenticated;

-- ── Event bonus: silent while off ─────────────────────────────
create or replace function public.creator_event_signup_bonus()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ref     public.referrals;
  v_creator public.creators;
  v_prog    public.creator_programs;
  v_event   public.live_events;
  v_claims  text;
  v_earning uuid;
begin
  if not public.creator_program_enabled() then return new; end if;

  select * into v_ref from public.referrals
   where referred_id = new.user_id and creator_id is not null limit 1;
  if v_ref.id is null then return new; end if;
  select * into v_creator from public.creators where id = v_ref.creator_id;
  if v_creator.id is null or v_creator.status <> 'active' then return new; end if;
  v_prog := public.creator_effective_program(v_creator.id);
  if v_prog.id is null or v_prog.event_signup_points <= 0 then return new; end if;
  if v_prog.event_signup_requires_conversion and v_ref.converted_at is null then return new; end if;
  select * into v_event from public.live_events where id = new.event_id;
  if v_event.status not in ('scheduled', 'live') then return new; end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text, true);

  insert into public.creator_earnings
    (creator_id, referral_id, event_id, kind, points_amount, note)
  values (v_creator.id, v_ref.id, new.event_id, 'event_signup', v_prog.event_signup_points,
          'A signup joined ' || coalesce(v_event.name, 'a live event'))
  on conflict do nothing
  returning id into v_earning;
  if v_earning is not null and v_creator.member_user_id is not null then
    insert into public.point_transactions (user_id, amount, type, source, description)
    values (v_creator.member_user_id, v_prog.event_signup_points, 'bonus', 'creator_event_signup',
            'A signup from your link joined ' || coalesce(v_event.name, 'a live event'));
    update public.creator_earnings set credited_at = now() where id = v_earning;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return new;
exception when others then
  raise warning 'creator_event_signup_bonus failed for %/%: %', new.event_id, new.user_id, sqlerrm;
  return new;
end;
$$;
revoke all on function public.creator_event_signup_bonus() from public, anon, authenticated;
