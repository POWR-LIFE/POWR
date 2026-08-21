-- Open board, activation layer.
--
-- The board as shipped had a chicken-and-egg hole: get_open_challenges returns
-- nothing unless the VIEWER has already opted in, so the only ways to discover
-- the feature were a Settings toggle and a checkbox inside the create sheet. An
-- opt-in nobody can find is an opt-in nobody takes, and the whole thing would
-- have sat there doing nothing.
--
-- Three pieces here:
--   1. get_open_board_teaser  — a COUNT for people who haven't opted in, so the
--      pitch can be "3 members are waiting" instead of a generic invitation.
--      Proof of liquidity beats persuasion.
--   2. an auto-friend trigger — finishing a stranger race together creates the
--      friend edge. The friend graph is the actual bottleneck (10 of 71 users
--      had one), so this is the compounding loop the board exists to feed.
--   3. open_board_stats — the funnel, so "did it work" is answerable.

-- ── 1. Teaser count for the not-yet-opted-in ─────────────────────────────────
-- Same eligibility as get_open_challenges MINUS the viewer's own opt-in, and
-- returning only a number: no names, no avatars, no ids. Someone who hasn't
-- opted in learns that people are waiting, and nothing about who they are.
create or replace function public.get_open_board_teaser()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from shared_challenges c
  join profiles p on p.id = c.creator_id
  cross join lateral (
    select count(*)::integer as heads
    from shared_challenge_participants sp
    where sp.challenge_id = c.id
      and sp.state not in ('declined', 'left')
  ) live
  where c.is_open
    and c.status in ('forming', 'active')
    and (c.ends_at is null or c.ends_at > now())
    and live.heads < 1 + c.open_slots
    and p.open_to_strangers
    and c.creator_id <> auth.uid()
    and not exists (
      select 1 from shared_challenge_participants mine
      where mine.challenge_id = c.id
        and mine.user_id = auth.uid()
        and mine.state not in ('declined', 'left')
    )
    and not exists (
      select 1 from friendships f
      where f.status = 'blocked'
        and f.user_id = least(auth.uid(), c.creator_id)
        and f.friend_id = greatest(auth.uid(), c.creator_id)
    )
    and not exists (
      select 1 from device_accounts a
      join device_accounts b on b.device_id = a.device_id
      where a.user_id = c.creator_id and b.user_id = auth.uid()
    );
$$;

revoke execute on function public.get_open_board_teaser() from anon, public;
grant execute on function public.get_open_board_teaser() to authenticated, service_role;

-- ── 2. Finishing together makes you friends ──────────────────────────────────
-- Fires when an OPEN challenge settles. Every pair who actually FINISHED gets an
-- accepted friendship; people who joined and didn't finish get nothing, because
-- the edge is meant to be earned rather than handed out for tapping "Take it".
--
-- ON CONFLICT DO NOTHING is load-bearing twice over: it makes the trigger
-- idempotent across a re-settle, and it means an existing 'blocked' row is left
-- exactly as it is — a block can never be downgraded into a friendship here.
create or replace function public.friend_open_board_finishers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(new.is_open, false) then return new; end if;
  -- Only on the transition into a settled state, so an ordinary progress
  -- update never re-runs this.
  if old.status = new.status then return new; end if;
  if new.status not in ('completed', 'expired') then return new; end if;

  insert into friendships (user_id, friend_id, status, requested_by)
  select least(a.user_id, b.user_id), greatest(a.user_id, b.user_id), 'accepted', new.creator_id
  from shared_challenge_participants a
  join shared_challenge_participants b
    on b.challenge_id = a.challenge_id and b.user_id > a.user_id
  where a.challenge_id = new.id
    and a.completed and b.completed
    and a.state not in ('declined', 'left')
    and b.state not in ('declined', 'left')
  on conflict (user_id, friend_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_friend_open_board_finishers on public.shared_challenges;
create trigger trg_friend_open_board_finishers
  after update of status on public.shared_challenges
  for each row
  execute function public.friend_open_board_finishers();

-- ── 3. The funnel, so "did it work" is answerable ────────────────────────────
-- Deliberately one row of plain counts: without this the board's failure mode is
-- indistinguishable from its success mode, because an empty board renders
-- nothing either way.
drop function if exists public.open_board_stats();
create function public.open_board_stats()
returns table(
  opted_in integer,
  posts_total integer,
  posts_live integer,
  posts_taken integer,
  posts_went_solo integer,
  takes_total integer,
  finished_pairs integer,
  users_with_a_friend integer,
  active_30d integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::integer from profiles where open_to_strangers),
    (select count(*)::integer from shared_challenges where is_open),
    (select count(*)::integer from shared_challenges where is_open and status in ('forming','active')),
    -- "taken" = someone other than the creator joined it
    (select count(distinct c.id)::integer from shared_challenges c
       join shared_challenge_participants sp on sp.challenge_id = c.id
      where c.is_open and sp.user_id <> c.creator_id and sp.state in ('accepted','completed')),
    -- "nobody took it": an open post is created solo_start=false (it is waiting
    -- on a stranger); only the untaken-post conversion ever sets it true.
    (select count(*)::integer from shared_challenges where is_open and solo_start),
    (select count(*)::integer from shared_challenges c
       join shared_challenge_participants sp on sp.challenge_id = c.id
      where c.is_open and sp.user_id <> c.creator_id and sp.state in ('accepted','completed')),
    (select count(*)::integer from shared_challenges c
       join shared_challenge_participants a on a.challenge_id = c.id and a.completed
       join shared_challenge_participants b on b.challenge_id = c.id and b.completed and b.user_id > a.user_id
      where c.is_open),
    -- The number that actually matters: the friend graph the board exists to grow.
    (select count(*)::integer from (
        select user_id id from friendships where status = 'accepted'
        union select friend_id from friendships where status = 'accepted') s),
    (select count(distinct user_id)::integer from activity_sessions
      where created_at > now() - interval '30 days');
$$;

revoke execute on function public.open_board_stats() from anon, public;
grant execute on function public.open_board_stats() to authenticated, service_role;
