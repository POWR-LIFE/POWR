-- =============================================================
-- PARTNER PORTAL SETUP INVITES
-- Tokenized self-signup for partner portal accounts (no email
-- infrastructure needed — the link is the credential, mirroring
-- the reward-submission invite flow). Admin mints a link via the
-- manage-partner-user edge function; the partner opens
-- /partner/setup/<token>, sets their own email + password, and
-- the edge function (service role) creates the auth user and the
-- partner_users link, then burns the token.
--
-- NO anon/authenticated policies: all public traffic goes through
-- the service-role edge function. Admins manage rows directly.
-- =============================================================

create table if not exists public.partner_portal_invites (
  id           uuid primary key default gen_random_uuid(),
  invite_token text not null unique,
  partner_id   uuid not null references public.partners(id) on delete cascade,
  status       text not null default 'invited'
                 check (status in ('invited', 'used', 'revoked')),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  used_at      timestamptz,
  used_by      uuid references auth.users(id) on delete set null
);

create index if not exists idx_partner_portal_invites_partner
  on public.partner_portal_invites (partner_id, status);

alter table public.partner_portal_invites enable row level security;

create policy "Admins manage portal invites"
  on public.partner_portal_invites for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));
