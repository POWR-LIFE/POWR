-- ============================================================================
-- Surface each friend's "Together" master opt-out to the Friends/invite UI.
-- together_enabled lives in auth.users.raw_user_meta_data (set from settings,
-- only an explicit `false` means opted out). The invite picker uses this to
-- stop you inviting a friend who has the whole feature switched off (they'd
-- never see the invite in-app and get no push, leaving a challenge stuck
-- forming). Default true when the key is absent (opted in).
--
-- RETURNS TABLE gains a column, so the function must be dropped + recreated
-- (create-or-replace can't change a function's return type).
-- ============================================================================
drop function if exists public.get_my_friendships();

create function public.get_my_friendships()
returns table (
  friend_user_id   uuid,
  username         text,
  display_name     text,
  avatar_url       text,
  status           text,
  requested_by     uuid,
  created_at       timestamptz,
  together_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when f.user_id = auth.uid() then f.friend_id else f.user_id end as friend_user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.status,
    f.requested_by,
    f.created_at,
    coalesce((au.raw_user_meta_data ->> 'together_enabled')::boolean, true) as together_enabled
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  join auth.users au
    on au.id = p.id
  where auth.uid() in (f.user_id, f.friend_id)
    and f.status <> 'blocked';
$$;

grant execute on function public.get_my_friendships() to authenticated;
revoke execute on function public.get_my_friendships() from public, anon;
