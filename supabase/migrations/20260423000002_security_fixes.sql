-- =============================================================
-- SECURITY FIXES
-- Resolves Supabase security advisor warnings:
--   1. Function Search Path Mutable (3 functions)
--   2. RLS Policy Always True (waitlist)
--   3. Public Bucket Allows Listing (5 storage buckets)
-- =============================================================

-- ── 1. Fix search_path on functions ──────────────────────────
-- Without SET search_path = '', a superuser could inject
-- malicious objects into a schema that appears before 'public'
-- in the search path and have them executed by these functions.

-- claim_pool_code: recreate with empty search_path
-- (all table refs are already schema-qualified as public.X)
create or replace function public.claim_pool_code(
  p_reward_id  uuid,
  p_user_id    uuid
) returns table (id uuid, code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_code text;
begin
  select rc.id, rc.code into v_id, v_code
    from public.redemption_codes rc
   where rc.reward_id = p_reward_id
     and rc.status = 'available'
     and rc.expires_at > now()
   order by rc.created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.redemption_codes
     set status           = 'reserved',
         assigned_user_id = p_user_id,
         assigned_at      = now()
   where redemption_codes.id = v_id;

  return query select v_id, v_code;
end;
$$;

revoke all on function public.claim_pool_code(uuid, uuid) from public, anon, authenticated;
-- Service role only.

-- support_tickets_set_updated_at: simple trigger, no table refs
create or replace function public.support_tickets_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- sync_admin_role: security definer trigger on profiles
create or replace function public.sync_admin_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.is_admin = true) then
    insert into public.admin_roles (user_id) values (new.id) on conflict do nothing;
  else
    delete from public.admin_roles where user_id = new.id;
  end if;
  return new;
end;
$$;

-- ── 2. Fix waitlist RLS – drop always-true SELECT policy ──────
-- "Allow anon read their own record" used USING (true) which
-- exposed every waitlist email to any anonymous visitor.
-- Anon users do not need to read waitlist rows after insert.
drop policy if exists "Allow anon read their own record" on public.waitlist;

-- ── 3. Restrict storage bucket SELECT policies ────────────────
-- These broad policies allowed any client to enumerate all
-- files in each bucket via the Storage API.
-- Public buckets still serve files via their public URL
-- (bypasses RLS), so restricting the SELECT policy here does
-- not break any existing functionality.

-- avatars
drop policy if exists "Public read access for avatars" on storage.objects;
create policy "Authenticated read access for avatars"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

-- landing-page-assets
drop policy if exists "Public Access" on storage.objects;
create policy "Authenticated read access for landing-page-assets"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'landing-page-assets');

-- partner-logos (remove duplicate broad policies, keep admin-managed ones)
drop policy if exists "Partner Logos Public Access" on storage.objects;
drop policy if exists "public read partner logos" on storage.objects;
create policy "Authenticated read access for partner-logos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'partner-logos');

-- reward-images
drop policy if exists "public read reward images" on storage.objects;
create policy "Authenticated read access for reward-images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'reward-images');

-- trainer-photos
drop policy if exists "Public read access for trainer photos" on storage.objects;
create policy "Authenticated read access for trainer-photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'trainer-photos');
