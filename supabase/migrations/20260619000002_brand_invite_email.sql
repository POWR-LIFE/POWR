-- Record the email address a brand setup link was sent to (when invited by
-- email rather than copy-link). Nullable: copy-link invites have no recipient.
alter table public.reward_brand_invites
  add column if not exists email text;
