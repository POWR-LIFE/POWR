-- Let the app see the two Vault levers it was blind to.
--
-- Until now an admin could change two things that materially alter a user's
-- Vault and the app would not (could not) say a word:
--
--   1. vault_auto_release_grace_days — unclaimed matured deposits auto-credit
--      after N days. Never mentioned anywhere in the app. A user staring at a
--      READY door had no idea a backstop existed, and an admin setting it to 0
--      silently retires the press-and-hold moment while the door carries on
--      presenting itself as something you unlock.
--
--   2. vault_unlock_events — a scheduled "Vault Day" pulls pending deposits to
--      READY at a chosen moment. vault_unlock_events is admin-read-only under
--      RLS, so between scheduling and firing the app kept counting down to the
--      ORIGINAL vests_at. That is not merely a missing feature: the countdown
--      is actively WRONG for the whole window, which is exactly the window
--      where the anticipation is worth something.
--
-- get_my_vault_outlook() is the app's read of both, scoped to the caller.
-- SECURITY DEFINER because vault_unlock_events is admin-only under RLS — the
-- function is the narrow window through which a user sees just the events
-- aimed at them.
--
-- `notify` doubles as "announce this". An event with notify on is pre-announced
-- in-app AND pushed when it fires; notify off stays a silent surprise drop and
-- is withheld here too. One flag, two coherent product modes — rather than a
-- second flag that could contradict the first.

create or replace function public.get_my_vault_outlook()
returns table (
  grace_days      int,
  auto_release_at timestamptz,
  next_unlock_at  timestamptz,
  next_unlock_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_grace   int := 7;
  v_soonest timestamptz;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Same parse + fallback as release_due_vault_deposits, so what the app
  -- promises and what the sweep does can never disagree.
  select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 7)
    into v_grace from system_config where key = 'vault_auto_release_grace_days';
  if v_grace is null or v_grace < 0 then
    v_grace := 7;
  end if;
  grace_days := v_grace;

  -- Earliest MATURED deposit decides the backstop: the sweep takes deposits
  -- overdue by the grace window, so this row auto-credits at vests_at + grace.
  -- Null when nothing is ready — there is no deadline to state.
  select min(vests_at) into v_soonest
    from vault_deposits
   where user_id = v_uid and released_at is null and vests_at <= now();
  auto_release_at := case
    when v_soonest is null then null
    else v_soonest + make_interval(days => v_grace)
  end;

  -- Soonest pending announceable event aimed at this user.
  select e.unlock_at, e.note
    into next_unlock_at, next_unlock_note
    from vault_unlock_events e
   where e.applied_at is null
     and e.unlock_at > now()
     and e.notify
     and (e.target = 'all' or v_uid = any (e.user_ids))
   order by e.unlock_at
   limit 1;

  -- An unlock the user has nothing to gain from is noise, not anticipation:
  -- the event only pulls deposits with vests_at > now(), so with nothing
  -- still vesting it would land as an empty promise.
  if next_unlock_at is not null and not exists (
    select 1 from vault_deposits
     where user_id = v_uid and released_at is null and vests_at > now()
  ) then
    next_unlock_at := null;
    next_unlock_note := null;
  end if;

  return next;
end;
$$;

revoke all on function public.get_my_vault_outlook() from public, anon;
grant execute on function public.get_my_vault_outlook() to authenticated;
