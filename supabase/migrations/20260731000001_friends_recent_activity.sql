-- Friend pulse for the home "challenge them" prompt: each accepted friend's
-- most recent sensor-verified session inside the window. SECURITY DEFINER
-- because RLS (rightly) blocks reading other users' activity_sessions; scoped
-- hard to the caller's accepted friendships. Returns ids + activity only —
-- names/avatars come from the client's own friends list (get_my_friendships),
-- so no profile data rides along. Walking is excluded: day-bucket rows would
-- make everyone "active" every day and the prompt would never feel earned.
create or replace function public.get_friends_recent_activity(p_hours integer default 24)
returns table (friend_id uuid, activity_type text, started_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (s.user_id) s.user_id, s.type, s.started_at
  from friendships f
  join activity_sessions s
    on s.user_id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  where f.status = 'accepted'
    and auth.uid() in (f.user_id, f.friend_id)
    and s.started_at >= now() - make_interval(hours => least(greatest(p_hours, 1), 168))
    and s.verification <> 'manual'
    and s.type in ('gym', 'running', 'cycling')
  order by s.user_id, s.started_at desc
$$;

-- 0028/0029 lockdown posture: authenticated + service_role only.
revoke execute on function public.get_friends_recent_activity(integer) from anon, public;
grant execute on function public.get_friends_recent_activity(integer) to authenticated, service_role;
