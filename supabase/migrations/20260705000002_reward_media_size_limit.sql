-- Reward hero videos live in the same public buckets as hero images. Give both
-- buckets an explicit 50 MB per-object limit so a big video is rejected cleanly
-- at the storage layer (not just by the client-side guard), and so the ceiling
-- is documented rather than implicitly inheriting the project-global default.
-- 50 MB is generous for a short, muted, looping card background; images are far
-- smaller so this does not affect them. (A per-bucket limit cannot exceed the
-- project-global storage limit — raise that in the dashboard first if you ever
-- need more than 50 MB.)

update storage.buckets
  set file_size_limit = 52428800  -- 50 MiB
  where id in ('reward-images', 'reward-submissions');
