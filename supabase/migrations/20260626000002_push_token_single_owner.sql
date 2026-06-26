-- One device (expo_push_token) = one owner.
--
-- A push token is per device-install. When someone signs into a different
-- account on the same device, the app re-registers the token under the new
-- user, but the OLD row was never removed (RLS only lets a client delete its
-- own rows). Result: the same token accumulates under multiple user_ids, so a
-- device keeps receiving pushes for an account no longer signed in on it, and
-- device counts are inflated. Fix it server-side.

-- 1. One-time cleanup: for any token registered under multiple users, keep the
--    most recently updated row (= whoever last logged in on that device).
delete from public.user_push_tokens
where id in (
  select id from (
    select id,
           row_number() over (
             partition by expo_push_token
             order by updated_at desc, created_at desc, id
           ) as rn
    from public.user_push_tokens
  ) ranked
  where rn > 1
);

-- 2. Going forward: when a token is (re)registered, drop it from every other
--    user. Trigger runs as definer so it bypasses the per-user RLS that blocks
--    the client from doing this itself. A DELETE doesn't re-fire this trigger,
--    so there's no recursion.
create or replace function public.enforce_single_owner_push_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_push_tokens
  where expo_push_token = new.expo_push_token
    and user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists trg_single_owner_push_token on public.user_push_tokens;
create trigger trg_single_owner_push_token
  after insert or update on public.user_push_tokens
  for each row execute function public.enforce_single_owner_push_token();
