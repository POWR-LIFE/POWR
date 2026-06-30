-- ============================================================================
-- PROFILE SOCIAL — the connective-tissue signals for the profile sheet.
--
-- One round-trip behind the profile card, computed against auth.uid():
--   friend_count        — how many friends THEY have (social proof)
--   mutual_count        — friends you have in common
--   mutual_preview      — up to 3 mutual friends (id/name/handle/avatar) for
--                         "you both know Jane & Sam +N"
--   friends_since       — when YOU two connected (null unless accepted) — drives
--                         the friends-only "relationship depth" line
--   challenges_together — shared challenges you've both taken part in
--
-- SECURITY DEFINER so it can read the target's friendships / participation
-- (RLS blocks cross-user reads); authenticated-only, anon revoked (0028/0029).
-- ============================================================================

create or replace function public.get_profile_social(p_user_id uuid)
returns table (
  friend_count        integer,
  mutual_count        integer,
  mutual_preview      jsonb,
  friends_since       timestamptz,
  challenges_together integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_user_id is null then
    return;
  end if;

  return query
  with their_friends as (
    select case when f.user_id = p_user_id then f.friend_id else f.user_id end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (f.user_id = p_user_id or f.friend_id = p_user_id)
  ),
  my_friends as (
    select case when f.user_id = v_me then f.friend_id else f.user_id end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (f.user_id = v_me or f.friend_id = v_me)
  ),
  mutuals as (
    select tf.fid
    from their_friends tf
    join my_friends mf on mf.fid = tf.fid
    where tf.fid <> v_me and tf.fid <> p_user_id
  ),
  together as (
    select scp_me.challenge_id
    from public.shared_challenge_participants scp_me
    join public.shared_challenge_participants scp_them
      on scp_them.challenge_id = scp_me.challenge_id
     and scp_them.user_id = p_user_id
    where scp_me.user_id = v_me
    group by scp_me.challenge_id
  )
  select
    (select count(*)::int from their_friends),
    (select count(*)::int from mutuals),
    coalesce((
      select jsonb_agg(j)
      from (
        select jsonb_build_object(
          'id',           p.id,
          'display_name', p.display_name,
          'username',     p.username,
          'avatar_url',   p.avatar_url
        ) as j
        from mutuals m
        join public.profiles p on p.id = m.fid
        order by p.display_name nulls last
        limit 3
      ) sub
    ), '[]'::jsonb),
    (select f.created_at
       from public.friendships f
      where f.status = 'accepted'
        and f.user_id  = least(v_me, p_user_id)
        and f.friend_id = greatest(v_me, p_user_id)
      limit 1),
    (select count(*)::int from together);
end;
$$;

grant execute on function public.get_profile_social(uuid) to authenticated;
revoke execute on function public.get_profile_social(uuid) from public, anon;
