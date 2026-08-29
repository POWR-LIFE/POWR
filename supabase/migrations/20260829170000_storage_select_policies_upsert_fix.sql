-- =============================================================
-- STORAGE: SELECT policies so upsert / RETURNING uploads pass RLS
-- =============================================================
-- 20260513000003 dropped every SELECT policy on the public buckets to stop
-- directory listing. Side effect nobody caught: Postgres also evaluates SELECT
-- policies for INSERT ... ON CONFLICT DO UPDATE (what the Storage API runs for
-- `upsert: true`) and for INSERT ... RETURNING. With zero SELECT policies on a
-- bucket, every upsert upload fails with "new row violates row-level security
-- policy for table objects". Avatars + covers (app Edit Profile and the admin
-- portal) and trainer-photos + partner-logos (admin portal) have all been
-- broken since 2026-05-13 — last successful avatar upload is 2026-05-12.
-- Buckets uploaded with `upsert: false` (share-cards, reward-images via
-- uploadPublicImage) never hit that path, which is why nobody noticed.
--
-- Fix: SELECT policies scoped to what the caller can already write. A member
-- only sees rows in their own <uid>/ folder, so nobody can enumerate anyone
-- else's files; admins see the buckets they manage. Public-URL reads are
-- unaffected either way (public buckets serve objects without RLS).

-- ── Members: own folder on the user media buckets ─────────────
drop policy if exists "Users can read their own avatar" on storage.objects;
create policy "Users can read their own avatar"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read their own cover" on storage.objects;
create policy "Users can read their own cover"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'covers'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read their own gallery photo" on storage.objects;
create policy "Users can read their own gallery photo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'gallery'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read their own share card" on storage.objects;
create policy "Users can read their own share card"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'share-cards'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- ── Admins: the buckets the admin portal upserts into ─────────
-- (user media buckets too — admin/UserProfile.jsx uploads avatars/covers
-- with upsert: true on a member's behalf)
drop policy if exists "Admins can read managed buckets" on storage.objects;
create policy "Admins can read managed buckets"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('avatars', 'covers', 'gallery',
                  'trainer-photos', 'partner-logos', 'reward-images')
    and exists (
      select 1 from public.admin_roles
      where admin_roles.user_id = (select auth.uid())
    )
  );
