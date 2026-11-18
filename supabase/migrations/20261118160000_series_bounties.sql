-- The bounty, back (Jamie, 2026-11-18), and run from /admin/series.
--
-- Applies AFTER 20261118150000_profile_flag_code.sql (independent of it: this
-- file only adds, nothing here restates a function from an earlier file).
--
-- An admin puts a bounty on one member of a running round, with a prize typed
-- in (a name, an optional line, sponsor and picture). The first member who was
-- BELOW them when it went on and climbs ABOVE them on Series points claims it
-- and wins that prize. Members already ahead at that moment can't claim it, so
-- a bounty is for the chasers. It stays on until it's claimed or an admin ends
-- it (an optional end time ends it too, and so does the round finishing).
--
-- A bounty is never points: it can't move anyone up the board. It's kept apart
-- from series_results, so the one-prize-each rule there doesn't touch it. No
-- pushes: the app shows it (a BOUNTY tag on the member's row, a card on the
-- Overall tab) and that's all.
--
-- Claims are checked every minute. While Blind Mode is on nothing is claimed
-- (a claim would say who is ahead of whom); a lead taken in the dark claims
-- when the ranks come back. Only listed members (on the leaderboard, not
-- excluded, not a demo account, never a pacer) can claim one.
--
--   1. series_bounties                  admin read only; written by the functions below
--   2. admin_series_place_bounty        put one on a member
--   3. admin_series_end_bounty          take one off
--   4. admin_series_bounties            the round's bounties for /admin/series
--   5. _series_settle_bounties + cron   claims, end times, rounds that finish
--   6. get_series_bounties              what the app shows
--
-- Idempotent: safe to run twice.

-- ── 1. The table ─────────────────────────────────────────────────────────────

create table if not exists public.series_bounties (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.series_rounds(id) on delete cascade,
  target_user_id  uuid not null references public.profiles(id) on delete cascade,
  prize           text not null check (length(trim(prize)) between 1 and 80),
  detail          text check (detail is null or length(detail) <= 200),
  sponsor         text check (sponsor is null or length(sponsor) <= 60),
  image_url       text,
  -- Null: on until it's claimed, an admin ends it or the round finishes.
  ends_at         timestamptz,
  -- Who was ahead of the target when it went on: they can't claim it.
  ahead_at_start  uuid[] not null default '{}',
  target_points_at_start int not null default 0,
  status          text not null default 'live' check (status in ('live', 'claimed', 'ended')),
  claimed_by      uuid references public.profiles(id) on delete set null,
  claimed_at      timestamptz,
  -- Both on Series points, the minute it was claimed.
  claimer_points  int,
  target_points   int,
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('admin', 'expired', 'round_over', 'target_out')),
  created_by      uuid,
  ended_by        uuid,
  created_at      timestamptz not null default now()
);

-- One live bounty per member per round.
create unique index if not exists series_bounties_one_live
  on public.series_bounties (round_id, target_user_id) where status = 'live';
create index if not exists series_bounties_round on public.series_bounties (round_id, created_at desc);
create index if not exists series_bounties_live on public.series_bounties (status) where status = 'live';

alter table public.series_bounties enable row level security;
drop policy if exists series_bounties_admin_read on public.series_bounties;
create policy series_bounties_admin_read on public.series_bounties
  for select to authenticated using ((select public.is_admin()));
-- No write policies: every write goes through the functions below, so the
-- "who was ahead" list is always taken from the board at that moment.

-- ── 2. Put a bounty on a member ──────────────────────────────────────────────

create or replace function public.admin_series_place_bounty(
  p_slug      text,
  p_user      uuid,
  p_prize     text,
  p_detail    text default null,
  p_sponsor   text default null,
  p_image_url text default null,
  p_ends_at   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round  public.series_rounds;
  v_t      record;
  v_ahead  uuid[];
  v_chase  int;
  v_id     uuid;
  v_prize  text := nullif(trim(coalesce(p_prize, '')), '');
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    raise exception 'no round called %', p_slug using errcode = 'P0001';
  end if;
  if now() < v_round.starts_at or now() >= v_round.ends_at then
    raise exception 'a bounty can only go on while the round is running' using errcode = 'P0001';
  end if;
  if v_prize is null then
    raise exception 'give the bounty a prize' using errcode = 'P0001';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'the end time has already passed' using errcode = 'P0001';
  end if;
  if p_ends_at is not null and p_ends_at > v_round.ends_at then
    raise exception 'the end time is after the round finishes' using errcode = 'P0001';
  end if;

  -- Serialise placings so two admins can't both put one on the same member.
  perform pg_advisory_xact_lock(hashtext('series_bounty:' || v_round.id::text));

  select p.points, p.listed into v_t from public._series_points(v_round.id) p where p.user_id = p_user;
  if not found then
    raise exception 'they aren''t in this round (not joined, excluded or a demo account)' using errcode = 'P0001';
  end if;
  if not v_t.listed then
    raise exception 'they''re hidden from leaderboards, so nobody could see the bounty' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.series_bounties b
              where b.round_id = v_round.id and b.target_user_id = p_user and b.status = 'live') then
    raise exception 'they already have a bounty on them, end that one first' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(p.user_id) filter (where p.points > v_t.points), '{}'),
         (count(*) filter (where p.listed and p.points <= v_t.points))::int
    into v_ahead, v_chase
    from public._series_points(v_round.id) p
   where p.user_id <> p_user;

  insert into public.series_bounties
    (round_id, target_user_id, prize, detail, sponsor, image_url, ends_at,
     ahead_at_start, target_points_at_start, created_by)
  values
    (v_round.id, p_user, v_prize, nullif(trim(coalesce(p_detail, '')), ''), nullif(trim(coalesce(p_sponsor, '')), ''),
     nullif(trim(coalesce(p_image_url, '')), ''), p_ends_at, v_ahead, v_t.points, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'ahead', cardinality(v_ahead), 'chasers', v_chase, 'points', v_t.points);
end;
$$;

-- ── 3. Take one off ──────────────────────────────────────────────────────────

create or replace function public.admin_series_end_bounty(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.series_bounties
     set status = 'ended', ended_at = now(), end_reason = 'admin', ended_by = auth.uid()
   where id = p_id and status = 'live';
  if not found then
    raise exception 'that bounty isn''t live any more (claimed or ended)' using errcode = 'P0001';
  end if;
end;
$$;

-- ── 4. The round's bounties, for /admin/series ───────────────────────────────

create or replace function public.admin_series_bounties(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_round public.series_rounds;
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    return '[]'::jsonb;
  end if;

  with pts as materialized (
    select p.*, row_number() over (order by p.points desc, p.user_id)::int as place
      from public._series_points(v_round.id) p
     where p.listed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'status', b.status,
           'prize', b.prize, 'detail', b.detail, 'sponsor', b.sponsor, 'image_url', b.image_url,
           'ends_at', b.ends_at, 'created_at', b.created_at,
           'claimed_at', b.claimed_at, 'ended_at', b.ended_at, 'end_reason', b.end_reason,
           'target_points_at_start', b.target_points_at_start,
           'claimer_points', b.claimer_points, 'target_points', b.target_points,
           'ahead', cardinality(b.ahead_at_start),
           -- Who can still claim it: listed members who weren't ahead at the start.
           'chasers', (select count(*) from pts x
                        where x.user_id <> b.target_user_id and not (x.user_id = any(b.ahead_at_start))),
           'target', jsonb_build_object(
             'user_id', b.target_user_id,
             'name', coalesce(nullif(trim(tp.display_name), ''), tp.username, 'POWR member'),
             'member_id', tp.referral_code,
             'points', t.points, 'place', t.place),
           'claimer', case when b.claimed_by is null then null else jsonb_build_object(
             'user_id', b.claimed_by,
             'name', coalesce(nullif(trim(cp.display_name), ''), cp.username, 'POWR member'),
             'member_id', cp.referral_code) end
         ) order by (b.status = 'live') desc, b.created_at desc), '[]'::jsonb)
    into v_out
    from public.series_bounties b
    join public.profiles tp on tp.id = b.target_user_id
    left join public.profiles cp on cp.id = b.claimed_by
    left join pts t on t.user_id = b.target_user_id
   where b.round_id = v_round.id;
  return v_out;
end;
$$;

-- ── 5. Claims, end times, rounds that finish ─────────────────────────────────
-- Every minute. The board is the round's Series points (_series_points), the
-- same numbers the app ranks on; pacers are never on it.

create or replace function public._series_settle_bounties()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b     public.series_bounties;
  v_round public.series_rounds;
  v_t     record;
  v_cuser uuid;
  v_cpts  int;
  v_n     int := 0;
begin
  for v_b in
    select * from public.series_bounties where status = 'live' order by created_at for update skip locked
  loop
    select * into v_round from public.series_rounds where id = v_b.round_id;
    -- Blind Mode: nothing is claimed or ended until the ranks come back.
    continue when now() < v_round.ends_at and exists (
      select 1 from public.series_moments m
       where m.round_id = v_round.id and m.kind = 'blind' and now() >= m.starts_at and now() < m.ends_at);

    select p.points, p.listed into v_t from public._series_points(v_round.id) p where p.user_id = v_b.target_user_id;
    if not found or not v_t.listed then
      -- Excluded, left the board or hid from leaderboards: nobody can see it now.
      update public.series_bounties set status = 'ended', ended_at = now(), end_reason = 'target_out' where id = v_b.id;
      v_n := v_n + 1;
      continue;
    end if;

    -- The best-placed chaser now above them claims it.
    v_cuser := null;
    v_cpts := null;
    select p.user_id, p.points into v_cuser, v_cpts
      from public._series_points(v_round.id) p
     where p.listed and p.points > v_t.points
       and p.user_id <> v_b.target_user_id
       and not (p.user_id = any(v_b.ahead_at_start))
     order by p.points desc, p.user_id
     limit 1;
    if v_cuser is not null then
      update public.series_bounties
         set status = 'claimed', claimed_by = v_cuser, claimed_at = now(),
             claimer_points = v_cpts, target_points = v_t.points
       where id = v_b.id;
      v_n := v_n + 1;
      continue;
    end if;

    if now() >= v_round.ends_at then
      update public.series_bounties set status = 'ended', ended_at = now(), end_reason = 'round_over' where id = v_b.id;
      v_n := v_n + 1;
    elsif v_b.ends_at is not null and now() >= v_b.ends_at then
      update public.series_bounties set status = 'ended', ended_at = now(), end_reason = 'expired' where id = v_b.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

select cron.unschedule('series-bounties') where exists (select 1 from cron.job where jobname = 'series-bounties');
select cron.schedule('series-bounties', '* * * * *', $cron$ select public._series_settle_bounties() $cron$);

-- ── 6. What the app shows ────────────────────────────────────────────────────
-- The round's live bounties, and the ones claimed in the last 24 hours (so the
-- board can say who took it). A bounty on someone hidden from leaderboards
-- isn't shown, unless it's on you. In Blind Mode the points and the gap are
-- left out: they'd say who is ahead of whom.
--
-- you.gap = the Series points you need to go above them (0 or less: you're
-- above them now and the claim lands within the minute).

create or replace function public.get_series_bounties(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
  v_blind boolean;
  v_out   jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug and (published or public.is_admin());
  else
    select * into v_round from public.series_rounds
     where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
  end if;
  if v_round.id is null then
    return null;
  end if;
  v_blind := exists (select 1 from public.series_moments m
                      where m.round_id = v_round.id and m.kind = 'blind' and now() >= m.starts_at and now() < m.ends_at);

  with pts as materialized (
    select * from public._series_points(v_round.id)
  ),
  me as (select * from pts where user_id = v_uid),
  shown as (
    select b.*
      from public.series_bounties b
     where b.round_id = v_round.id
       and (b.status = 'live' or (b.status = 'claimed' and b.claimed_at > now() - interval '24 hours'))
       and (b.target_user_id = v_uid
            or exists (select 1 from pts x where x.user_id = b.target_user_id and x.listed))
     order by (b.status = 'live') desc, coalesce(b.claimed_at, b.created_at) desc
     limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'status', b.status,
           'prize', b.prize, 'detail', b.detail, 'sponsor', b.sponsor, 'image_url', b.image_url,
           'placed_at', b.created_at, 'ends_at', b.ends_at, 'claimed_at', b.claimed_at,
           'target', jsonb_build_object(
             'user_id', b.target_user_id,
             'name', coalesce(nullif(trim(tp.display_name), ''), tp.username, 'POWR member'),
             'avatar_url', tp.avatar_url,
             'you', b.target_user_id = v_uid,
             'points', case when v_blind then null else t.points end),
           'claimer', case when b.claimed_by is null then null else jsonb_build_object(
             'user_id', b.claimed_by,
             'name', coalesce(nullif(trim(cp.display_name), ''), cp.username, 'POWR member'),
             'avatar_url', cp.avatar_url,
             'you', b.claimed_by = v_uid) end,
           'you', case when m.user_id is null or b.target_user_id = v_uid then null else jsonb_build_object(
             'can_claim', not (v_uid = any(b.ahead_at_start)),
             'gap', case when v_blind or v_uid = any(b.ahead_at_start) or t.points is null then null
                         else t.points - m.points + 1 end) end
         ) order by (b.status = 'live') desc, coalesce(b.claimed_at, b.created_at) desc), '[]'::jsonb)
    into v_out
    from shown b
    join public.profiles tp on tp.id = b.target_user_id
    left join public.profiles cp on cp.id = b.claimed_by
    left join pts t on t.user_id = b.target_user_id
    left join me m on true;

  return jsonb_build_object('round', v_round.slug, 'blind', v_blind, 'bounties', v_out);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on table public.series_bounties from anon;
grant select on table public.series_bounties to authenticated;

revoke all on function public.admin_series_place_bounty(text, uuid, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.admin_series_end_bounty(uuid) from public, anon;
revoke all on function public.admin_series_bounties(text) from public, anon;
revoke all on function public._series_settle_bounties() from public, anon, authenticated;
revoke all on function public.get_series_bounties(text) from public, anon;
grant execute on function public.admin_series_place_bounty(text, uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.admin_series_end_bounty(uuid) to authenticated;
grant execute on function public.admin_series_bounties(text) to authenticated;
grant execute on function public._series_settle_bounties() to service_role;
grant execute on function public.get_series_bounties(text) to authenticated;
