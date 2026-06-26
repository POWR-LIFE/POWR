-- Pending-action counts for the in-app avatar badge.
--
-- One cheap round trip returning everything that "needs the user to interact":
--   • friend_requests   — incoming friend requests awaiting accept/decline
--   • challenge_invites  — shared-challenge invites you haven't responded to
--
-- SECURITY DEFINER so we can read invited participant rows without depending on
-- the participants read-RLS (which is gated behind is_challenge_participant);
-- authenticated-only + revoked from public/anon to match the 0028/0029 lockdown.

create or replace function public.get_pending_action_counts()
returns table (friend_requests integer, challenge_invites integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(*)::int
      from public.friendships f
      where f.status = 'pending'
        and f.requested_by <> auth.uid()
        and auth.uid() in (f.user_id, f.friend_id)
    ),
    (
      select count(*)::int
      from public.shared_challenge_participants p
      join public.shared_challenges c on c.id = p.challenge_id
      where p.user_id = auth.uid()
        and p.state = 'invited'
        and c.status in ('forming', 'active')
    );
$$;

grant execute on function public.get_pending_action_counts() to authenticated;
revoke execute on function public.get_pending_action_counts() from public, anon;
