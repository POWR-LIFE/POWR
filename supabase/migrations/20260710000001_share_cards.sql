-- Share cards: the captured 9:16 card, published so chat apps can render it as
-- a link preview.
--
-- WhatsApp/iMessage/X fetch og:image with no auth and no cookies, so the bucket
-- has to be public. The object name is a random uuid under the owner's folder,
-- so a card is unguessable rather than merely unlisted.

insert into storage.buckets (id, name, public)
values ('share-cards', 'share-cards', true)
on conflict (id) do nothing;

create policy "Users can upload their own share card"
  on storage.objects for insert
  with check (
    bucket_id = 'share-cards'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own share card"
  on storage.objects for delete
  using (
    bucket_id = 'share-cards'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

-- The row the /s/<id> Open Graph page is rendered from. It is read by the
-- share-card-og edge function under the service role, which bypasses RLS —
-- members can only ever select their own, so nobody can enumerate anyone else's
-- (titles carry display names and venue names).
create table public.share_cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  image_path    text not null,
  title         text not null,
  subtitle      text,
  referral_code text,
  created_at    timestamptz not null default now()
);

alter table public.share_cards enable row level security;

create policy "Users can create their own share card"
  on public.share_cards for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can read their own share cards"
  on public.share_cards for select
  to authenticated
  using (auth.uid() = user_id);

-- Cards accumulate one row + one image per share. Indexed for the retention
-- sweep that will prune them.
create index share_cards_created_at_idx on public.share_cards (created_at);
