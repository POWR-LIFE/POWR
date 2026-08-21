-- Applied to prod via MCP across three passes on 2026-08-21; committed here so a
-- rebuilt environment matches. An adversarial review caught that
-- get_open_board_audience and the notification_preferences column existed ONLY
-- in the live database — a fresh replay of this repo would have produced a
-- board fan-out calling a function that doesn't exist.

-- ── The board push needs a real preference column ────────────────────────────
-- send-push-notification derives the preference column from the type name,
-- falling through to `: type`. Its own comment warns why a type with no matching
-- column must never reach that fallback: selecting a non-existent column 400s on
-- every send, the error is discarded, and the opt-out is silently decorative.
--
-- challenge_open_unclaimed rides `challenge_started` in code — it IS that event.
-- challenge_open_posted gets its own column: the app's grouped switch is labelled
-- "Friend activity", and a stranger's board post is precisely not that.
alter table public.notification_preferences
  add column if not exists challenge_open_posted boolean not null default true;

comment on column public.notification_preferences.challenge_open_posted is
  'Push when a new challenge lands on the open board. Separate from the friend-activity group — these come from people you have never met.';

-- ── Who to announce a board post to ──────────────────────────────────────────
-- One round-trip instead of an eligibility RPC per candidate. The fan-out
-- previously looped up to 200 candidates calling can_take_open_challenge and
-- then a full HTTP push per head — roughly 2000 sequential round-trips inside a
-- single 15-minute cron tick, with nothing bounding it as the base grew.
--
-- The daily-cap clause is load-bearing, not an optimisation. board_notified is a
-- ONE-WAY latch with no un-latch path, and challenge_open_posted carries
-- daily_cap=1 enforced per recipient per local day. Without this clause, a second
-- post on the same day was latched and then had every single send refused
-- 'type_daily_cap' — announced to nobody, permanently, while the cron reported
-- success. Excluding capped users here lets the caller treat an empty audience as
-- "nobody to tell yet" and leave the post for a later tick.
create or replace function public.get_open_board_audience(p_challenge_id uuid, p_limit integer default 100)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select taker.id
  from shared_challenges c
  join profiles p on p.id = c.creator_id
  join profiles taker on taker.open_to_strangers and taker.id <> c.creator_id
  where c.id = p_challenge_id
    and c.is_open
    and c.status in ('forming', 'active')
    and (c.ends_at is null or c.ends_at > now())
    and p.open_to_strangers
    and (
      select count(*) from shared_challenge_participants sp
      where sp.challenge_id = c.id and sp.state not in ('declined', 'left')
    ) < 1 + c.open_slots
    and not exists (
      select 1 from shared_challenge_participants mine
      where mine.challenge_id = c.id and mine.user_id = taker.id
        and mine.state not in ('declined', 'left')
    )
    and not exists (
      select 1 from friendships f
      where f.status = 'blocked'
        and f.user_id = least(taker.id, c.creator_id)
        and f.friend_id = greatest(taker.id, c.creator_id)
    )
    and not exists (
      select 1 from device_accounts a
      join device_accounts b on b.device_id = a.device_id
      where a.user_id = c.creator_id and b.user_id = taker.id
    )
    and exists (select 1 from user_push_tokens t where t.user_id = taker.id)
    and not exists (
      select 1 from push_send_log l
      where l.user_id = taker.id
        and l.type = 'challenge_open_posted'
        and l.status <> 'skipped'
        and l.created_at >= (
          date_trunc('day', now() at time zone coalesce(nullif(taker.timezone, ''), 'Europe/London'))
        ) at time zone coalesce(nullif(taker.timezone, ''), 'Europe/London')
    )
  order by taker.id
  limit greatest(1, least(p_limit, 500));
$$;

revoke execute on function public.get_open_board_audience(uuid, integer) from anon, public;
grant execute on function public.get_open_board_audience(uuid, integer) to authenticated, service_role;

-- Belt and braces against a replay landing the wrong class: the nudge pool holds
-- one slot a user's streak warning already competes for.
update public.notification_config
   set class = 'social', daily_cap = 1
 where type = 'challenge_open_posted';
