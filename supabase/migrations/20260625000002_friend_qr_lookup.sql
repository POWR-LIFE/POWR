-- ============================================================================
-- QR FRIEND-LINKING — resolve a person from their shareable code.
--
-- The in-app QR encodes the owner's existing profiles.referral_code (one code,
-- double duty: friending here + the referral reward via process_referral). The
-- scan/confirm screen needs to turn that code into a profile card AND know where
-- the caller already stands with that person, so it can show the right CTA in a
-- single round-trip.
--
-- `relationship` is computed against auth.uid() and the canonical friendships
-- row (low id = user_id, matching get_my_friendships / search_profiles_by_username):
--   self | none | pending_outgoing | pending_incoming | accepted
-- A blocked pair, and any unknown code, return ZERO rows — the screen shows a
-- neutral "couldn't find that person" and a block is never revealed.
-- ============================================================================

create or replace function public.get_profile_by_referral_code(p_code text)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  relationship text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_target uuid;
  v_status text;
  v_req_by uuid;
begin
  if v_me is null then
    return;  -- unauthenticated → no rows
  end if;

  select p.id into v_target
    from public.profiles p
   where p.referral_code = upper(btrim(coalesce(p_code, '')));

  if v_target is null then
    return;  -- unknown code → neutral not-found
  end if;

  -- Current friendship state for this pair, if any (canonical low/high order).
  select f.status, f.requested_by
    into v_status, v_req_by
    from public.friendships f
   where f.user_id  = least(v_me, v_target)
     and f.friend_id = greatest(v_me, v_target);

  -- Never reveal a block — present it as not-found.
  if v_status = 'blocked' then
    return;
  end if;

  return query
    select
      p.id,
      p.username,
      p.display_name,
      p.avatar_url,
      case
        when v_target = v_me                              then 'self'
        when v_status = 'accepted'                        then 'accepted'
        when v_status = 'pending' and v_req_by = v_me     then 'pending_outgoing'
        when v_status = 'pending'                         then 'pending_incoming'
        else 'none'
      end as relationship
    from public.profiles p
   where p.id = v_target;
end;
$$;

grant execute on function public.get_profile_by_referral_code(text) to authenticated;
-- Keep off the anon REST surface (project 0028/0029 lockdown).
revoke execute on function public.get_profile_by_referral_code(text) from public, anon;
