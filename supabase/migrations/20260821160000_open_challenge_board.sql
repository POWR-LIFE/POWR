-- Open challenge board — human opponents for the ~2/3 of active users who have
-- no friends to invite (measured 2026-08-21: 29 active in 30d, only 10 with a
-- single accepted friendship). A creator marks a challenge OPEN; it sits on a
-- shelf every opted-in member can see, and the first taker becomes their
-- opponent.
--
-- Deliberately a board, not a matchmaker: matching needs two people wanting the
-- same thing at the same moment, which at this scale resolves to nobody. A
-- board is asynchronous — post Tuesday, taken Thursday — and when it is empty
-- it simply hides instead of announcing a failed search.
--
-- Privacy: appearing on the board is strictly opt-in (open_to_strangers,
-- default false) and the RPC exposes a FIRST NAME and avatar only, never the
-- stored display_name in full.

-- ── Opt-in ───────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists open_to_strangers boolean not null default false;

comment on column public.profiles.open_to_strangers is
  'Opt-in: may post to and take from the open challenge board. Off by default — '
  'a non-friend sees the user''s first name, avatar and challenge progress.';

-- ── The challenge side ───────────────────────────────────────────────────────
-- open_slots = how many takers the creator wants (live head cap is 1 + slots).
-- Default 1: "first to take it races you". Small groups keep a stranger run
-- short and cheap to fail, which matters when 73% of shared challenges already
-- die silently between friends.
alter table public.shared_challenges
  add column if not exists is_open boolean not null default false,
  add column if not exists open_slots smallint not null default 1;

alter table public.shared_challenges
  drop constraint if exists shared_challenges_open_slots_ck;
alter table public.shared_challenges
  add constraint shared_challenges_open_slots_ck check (open_slots between 1 and 5);

-- Partial index: the board query only ever looks at live open challenges.
create index if not exists shared_challenges_open_board_idx
  on public.shared_challenges (created_at desc)
  where is_open and status in ('forming', 'active');

-- ── The board ────────────────────────────────────────────────────────────────
-- Everything a taker needs to decide, and nothing more. Filters, in order:
--   · the challenge is open, live, and not already full
--   · BOTH sides opted in to strangers
--   · it isn't mine, and I'm not already on its roster
--   · no block edge in either direction (rows are canonical low<high)
--   · the creator doesn't share a device with me — the cheapest, highest-signal
--     guard against farming the co-completion bonus with a second account
drop function if exists public.get_open_challenges();

create function public.get_open_challenges()
returns table(
  id uuid, creator_id uuid, creator_name text, creator_avatar text,
  kind text, template jsonb, rule jsonb, category text,
  base_points integer, status text, duration_hours integer,
  starts_at timestamptz, ends_at timestamptz,
  bonus_per_head integer, bonus_max integer,
  slots_left integer, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as uid
  ),
  my_devices as (
    select da.device_id from device_accounts da, me where da.user_id = me.uid
  )
  select
    c.id,
    c.creator_id,
    -- First name only. The board is the one surface where a non-friend sees a
    -- member, so it shows the least that still reads as a person.
    nullif(split_part(coalesce(p.display_name, p.username, ''), ' ', 1), '') as creator_name,
    p.avatar_url as creator_avatar,
    c.kind, c.template, c.rule, c.category,
    c.base_points, c.status, c.duration_hours,
    c.starts_at, c.ends_at,
    c.bonus_per_head, c.bonus_max,
    (1 + c.open_slots - live.heads)::integer as slots_left,
    c.created_at
  from shared_challenges c
  join profiles p on p.id = c.creator_id
  cross join me
  cross join lateral (
    select count(*)::integer as heads
    from shared_challenge_participants sp
    where sp.challenge_id = c.id
      and sp.state not in ('declined', 'left')
  ) live
  where c.is_open
    and c.status in ('forming', 'active')
    -- An active challenge is still takeable, but only while its clock has time
    -- left to be worth taking.
    and (c.ends_at is null or c.ends_at > now())
    and live.heads < 1 + c.open_slots
    and p.open_to_strangers
    and exists (select 1 from profiles mp, me where mp.id = me.uid and mp.open_to_strangers)
    and c.creator_id <> me.uid
    and not exists (
      select 1 from shared_challenge_participants mine
      where mine.challenge_id = c.id
        and mine.user_id = me.uid
        and mine.state not in ('declined', 'left')
    )
    and not exists (
      select 1 from friendships f
      where f.status = 'blocked'
        and f.user_id = least(me.uid, c.creator_id)
        and f.friend_id = greatest(me.uid, c.creator_id)
    )
    and not exists (
      select 1 from device_accounts da
      where da.user_id = c.creator_id
        and da.device_id in (select device_id from my_devices)
    )
  order by c.created_at desc
  limit 20;
$$;

revoke execute on function public.get_open_challenges() from anon, public;
grant execute on function public.get_open_challenges() to authenticated, service_role;

-- ── Server-side guard for the join path ──────────────────────────────────────
-- respond-shared-challenge runs on the service role, so it cannot lean on the
-- RPC above for authorisation. This mirrors the board's eligibility rules for a
-- single (taker, challenge) pair so a hand-crafted call can't bypass the opt-in,
-- the block list, or the same-device rule.
create or replace function public.can_take_open_challenge(p_challenge_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from shared_challenges c
    join profiles p on p.id = c.creator_id
    join profiles taker on taker.id = p_user_id
    where c.id = p_challenge_id
      and c.is_open
      and c.status in ('forming', 'active')
      and (c.ends_at is null or c.ends_at > now())
      and p.open_to_strangers
      and taker.open_to_strangers
      and c.creator_id <> p_user_id
      and (
        select count(*) from shared_challenge_participants sp
        where sp.challenge_id = c.id and sp.state not in ('declined', 'left')
      ) < 1 + c.open_slots
      and not exists (
        select 1 from friendships f
        where f.status = 'blocked'
          and f.user_id = least(p_user_id, c.creator_id)
          and f.friend_id = greatest(p_user_id, c.creator_id)
      )
      and not exists (
        select 1 from device_accounts a
        join device_accounts b on b.device_id = a.device_id
        where a.user_id = c.creator_id and b.user_id = p_user_id
      )
  );
$$;

revoke execute on function public.can_take_open_challenge(uuid, uuid) from anon, public;
grant execute on function public.can_take_open_challenge(uuid, uuid) to authenticated, service_role;
