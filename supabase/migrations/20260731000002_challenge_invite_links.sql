-- Challenge invite links: an unguessable per-challenge token behind
-- https://powr.life/c/<token>. Anyone with the link can join the challenge
-- (and is auto-friended with the creator) — the share-link recruitment loop
-- from the original Together scope. The token is the only secret; it is never
-- exposed through the list RPCs, only to the creator via the RPC below.
alter table public.shared_challenges
  add column if not exists invite_token uuid not null default gen_random_uuid();

create unique index if not exists shared_challenges_invite_token_idx
  on public.shared_challenges (invite_token);

-- Creator-only token fetch, and only while the challenge can still be joined.
create or replace function public.get_challenge_invite_token(p_challenge_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.invite_token
  from shared_challenges c
  where c.id = p_challenge_id
    and c.creator_id = auth.uid()
    and c.status in ('forming', 'active')
$$;

revoke execute on function public.get_challenge_invite_token(uuid) from anon, public;
grant execute on function public.get_challenge_invite_token(uuid) to authenticated, service_role;
