-- Partner roles: a partner can be an earning_location, a reward_provider, or both.
alter table public.partners
  add column if not exists roles text[] not null default array['earning_location']::text[];

update public.partners p
   set roles = array(select distinct unnest(p.roles || array['reward_provider']))
 where exists (select 1 from public.rewards r where r.partner_id = p.id);

-- Rewards: image, kind, terms, value_label.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_kind') then
    create type public.reward_kind as enum ('digital', 'physical');
  end if;
end$$;

alter table public.rewards
  add column if not exists image_url text,
  add column if not exists reward_kind public.reward_kind not null default 'digital',
  add column if not exists terms text,
  add column if not exists value_label text;

-- Public storage buckets.
insert into storage.buckets (id, name, public)
  values ('partner-logos', 'partner-logos', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('reward-images', 'reward-images', true)
  on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'public read partner logos') then
    create policy "public read partner logos"
      on storage.objects for select using (bucket_id = 'partner-logos');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'auth write partner logos') then
    create policy "auth write partner logos"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'partner-logos');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'auth update partner logos') then
    create policy "auth update partner logos"
      on storage.objects for update to authenticated
      using (bucket_id = 'partner-logos');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public read reward images') then
    create policy "public read reward images"
      on storage.objects for select using (bucket_id = 'reward-images');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'auth write reward images') then
    create policy "auth write reward images"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'reward-images');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'auth update reward images') then
    create policy "auth update reward images"
      on storage.objects for update to authenticated
      using (bucket_id = 'reward-images');
  end if;
end$$;
