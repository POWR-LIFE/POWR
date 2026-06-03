-- =============================================================
-- PARTNER REWARD SUBMISSIONS
-- Tokenized partner intake for new rewards. Mirrors the
-- athlete_applications flow: admin creates an `invited` row and
-- shares /partner-reward/<invite_token>; the partner fills in the
-- public form (via the partner-reward-submission edge function,
-- service role) which flips the row to `pending`; an admin reviews
-- and, on approval, creates the live (inactive) reward.
--
-- All partner-facing traffic goes through the edge function — this
-- table has NO anon/authenticated policies, only an admin policy.
-- =============================================================

create table if not exists public.reward_submissions (
  id                uuid primary key default gen_random_uuid(),
  invite_token      text not null unique,
  status            text not null default 'invited'
                      check (status in ('invited','pending','approved','rejected')),

  -- Brand / contact
  partner_id        uuid references public.partners(id) on delete set null,
  brand_name        text,
  contact_name      text,
  contact_email     text,

  -- Reward fields (mirror public.rewards)
  title             text,
  description       text,
  category          text,                 -- legacy partner_category value (food/gym/health/gear)
  value_label       text,
  discount_type     text check (discount_type in ('percentage','fixed_amount')),
  discount_value    numeric(10,2),
  offer             text,
  partner_blurb     text,
  terms             text,
  reward_kind       text not null default 'digital' check (reward_kind in ('digital','physical')),
  url               text,
  image_url         text,                 -- logo / square brand image
  hero_image_url    text,
  brand_color       text,
  code_prefix       text,                 -- chosen middle segment, e.g. 'TRIBE' → POWR-TRIBE-XXXXXX

  -- Review / lifecycle
  reviewer_notes    text,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  submitted_at      timestamptz,
  created_reward_id uuid references public.rewards(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_reward_submissions_status on public.reward_submissions (status, created_at desc);

alter table public.reward_submissions enable row level security;

-- Admins (admin_roles) have full access. No anon/authenticated policies:
-- the public form reads & writes exclusively via the service-role edge function.
drop policy if exists "Admins manage reward submissions" on public.reward_submissions;
create policy "Admins manage reward submissions"
  on public.reward_submissions for all
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- Storage bucket for partner-uploaded imagery (logo + hero).
-- Public bucket: files are served by their public URL with no RLS
-- evaluation. Anon may INSERT (the partner is unauthenticated);
-- listing is restricted to admins to prevent enumeration.
-- =============================================================
insert into storage.buckets (id, name, public)
  values ('reward-submissions', 'reward-submissions', true)
  on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'anon write reward submissions' and tablename = 'objects') then
    create policy "anon write reward submissions"
      on storage.objects for insert
      to anon, authenticated
      with check (bucket_id = 'reward-submissions');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'admin list reward submissions' and tablename = 'objects') then
    create policy "admin list reward submissions"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'reward-submissions'
        and exists (select 1 from public.admin_roles where user_id = auth.uid())
      );
  end if;
end$$;
