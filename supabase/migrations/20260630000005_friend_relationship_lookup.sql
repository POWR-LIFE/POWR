-- ============================================================================
-- FRIEND RELATIONSHIP LOOKUP — where do I stand with this person?
--
-- The public profile sheet (UserProfileSheet) is now the one reusable surface
-- for viewing any user — opened from the leaderboard, friends list, challenge
-- participants, etc. To render the right CTA (Add friend / Requested / Accept /
-- Friends) it needs to know the caller's friendship state with the target.
--
-- Callers that already hold that state (the friends screen, which loads the
-- whole graph via get_my_friendships) pass it straight in; everyone else resolves
-- it here in a single round-trip. This mirrors the relationship CASE in
-- get_profile_by_referral_code (the QR flow), but keyed on a user id instead of
-- a referral code:
--   self | none | pending_outgoing | pending_incoming | accepted | blocked
-- Computed against auth.uid() and the canonical friendships row (low id = user_id).
-- ============================================================================

create or replace function public.get_friend_relationship(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_status text;
  v_req_by uuid;
begin
  if v_me is null or p_user_id is null then
    return 'none';
  end if;

  if p_user_id = v_me then
    return 'self';
  end if;

  -- Current friendship state for this pair, if any (canonical low/high order).
  select f.status, f.requested_by
    into v_status, v_req_by
    from public.friendships f
   where f.user_id  = least(v_me, p_user_id)
     and f.friend_id = greatest(v_me, p_user_id);

  return case
    when v_status = 'blocked'                       then 'blocked'
    when v_status = 'accepted'                       then 'accepted'
    when v_status = 'pending' and v_req_by = v_me    then 'pending_outgoing'
    when v_status = 'pending'                         then 'pending_incoming'
    else 'none'
  end;
end;
$$;

grant execute on function public.get_friend_relationship(uuid) to authenticated;
-- Keep off the anon REST surface (project 0028/0029 lockdown).
revoke execute on function public.get_friend_relationship(uuid) from public, anon;
