-- =============================================================
-- PRO STORAGE BUCKETS + ADMIN WRITE POLICIES
-- Adds `covers` and `gallery` public buckets with owner-scoped
-- RLS, plus admin override policies on avatars, covers, gallery,
-- and pro_gallery_photos so the admin dashboard can manage any
-- user's media.
-- =============================================================

-- ── 1. Buckets ───────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('gallery', 'gallery', true)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Covers: owner-scoped + public read ────────────────────

CREATE POLICY "Public read access for covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'covers');

CREATE POLICY "Users can upload their own cover"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'covers'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own cover"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'covers'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own cover"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'covers'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── 3. Gallery: owner-scoped + public read ───────────────────

CREATE POLICY "Public read access for gallery"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'gallery');

CREATE POLICY "Users can upload their own gallery photo"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'gallery'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own gallery photo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'gallery'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own gallery photo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'gallery'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── 4. Admin overrides across avatars/covers/gallery ─────────
-- Admins can upload/update/delete any object in these buckets.

CREATE POLICY "Admins can upload to user media buckets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id IN ('avatars', 'covers', 'gallery')
    AND EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update user media buckets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id IN ('avatars', 'covers', 'gallery')
    AND EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can delete from user media buckets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id IN ('avatars', 'covers', 'gallery')
    AND EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

-- ── 5. Admin INSERT on pro_gallery_photos ────────────────────
-- Lets admins create gallery rows on behalf of any pro athlete.

CREATE POLICY "Admins can insert any gallery photo"
  ON public.pro_gallery_photos FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update any gallery photo"
  ON public.pro_gallery_photos FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );
