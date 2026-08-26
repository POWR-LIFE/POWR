-- ============================================================================
-- App → web portal session handoff
-- ============================================================================
-- A member tapping "Open the full portal" in the app should land on
-- powr.life/affiliate already signed in — whatever identity they used in the
-- app (Apple, Google, email). The app mints a one-time ticket here, opens the
-- portal with it in the URL FRAGMENT (never sent to the server or logged),
-- and the portal-handoff edge function burns it, mints a magic-link token for
-- that user under the service role, and the browser verifies it into a normal
-- web session. Identity-agnostic by construction: no password ever exists.
--
-- Same shape as device_wake_tickets: random 32 bytes, sha256 at rest, short
-- TTL, single use, bound to the signed-in user. No RLS policies on purpose —
-- the table is reachable only through the two SECURITY DEFINER functions.

create table if not exists public.portal_handoff_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists portal_handoff_tickets_user_idx
  on public.portal_handoff_tickets (user_id, created_at desc);

alter table public.portal_handoff_tickets enable row level security;
revoke all on public.portal_handoff_tickets from public, anon, authenticated;

-- Called by the app with the user's own JWT. Returns the plaintext ticket
-- exactly once; only its hash is stored. 90 s is generous for a tap → browser
-- sheet → first request, and short enough that a leaked URL is worthless.
create or replace function public.mint_portal_handoff()
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_token  text;
  v_recent integer;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select count(*) into v_recent
    from public.portal_handoff_tickets
   where user_id = v_uid and created_at > now() - interval '1 minute';
  if v_recent >= 5 then raise exception 'rate_limited'; end if;

  -- Housekeeping on the way through: spent or stale tickets for this user.
  delete from public.portal_handoff_tickets
   where user_id = v_uid and (used_at is not null or expires_at < now());

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.portal_handoff_tickets (user_id, token_hash, expires_at)
  values (v_uid, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '90 seconds');

  return v_token;
end;
$$;

revoke all on function public.mint_portal_handoff() from public, anon;
grant execute on function public.mint_portal_handoff() to authenticated;

-- Called by the portal-handoff edge function under the service role. Burns
-- the ticket atomically (the UPDATE is the claim) and returns the user it was
-- minted for, or null for anything unknown, spent or expired.
create or replace function public.consume_portal_handoff(p_ticket text)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  update public.portal_handoff_tickets
     set used_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_ticket, ''), 'sha256'), 'hex')
     and used_at is null
     and expires_at > now()
  returning user_id into v_uid;
  return v_uid;
end;
$$;

revoke all on function public.consume_portal_handoff(text) from public, anon, authenticated;
grant execute on function public.consume_portal_handoff(text) to service_role;
