-- Studio → Instagram, Phase 1: POWR's OWN account, admin Studio only.
--
-- studio_social_posts   one row per post (now or scheduled). The admin Studio
--                       uploads the rendered JPEG / MP4 files to the private
--                       `studio-social` bucket and inserts the row; the
--                       publish-instagram function claims due rows
--                       (UPDATE … WHERE status = 'scheduled' RETURNING) and
--                       walks them through the Graph API.
-- studio_social_accounts the connected account and its long-lived token.
--                       RLS on with NO policies: only the service role (the
--                       edge function) can read or write it. Clients see the
--                       connection state through studio_social_account_status().
--
-- A cron tick every 5 minutes asks the function to publish whatever is due,
-- through the same x-resolve-token / Vault gate as the other cron functions.

create table if not exists public.studio_social_posts (
    id uuid primary key default gen_random_uuid(),
    platform text not null default 'instagram' check (platform in ('instagram')),
    kind text not null check (kind in ('image', 'carousel', 'reel', 'story')),
    caption text not null default '' check (char_length(caption) <= 2200),
    -- [{ "path": "posts/<id>/01.jpg", "type": "image" | "video", "width": 1080, "height": 1350 }]
    -- plus an optional small "thumb" path for the list.
    media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
    thumb_path text,
    format text,
    status text not null default 'scheduled'
        check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
    scheduled_at timestamptz not null default now(),
    published_at timestamptz,
    ig_media_id text,
    permalink text,
    error text,
    note text,
    attempts integer not null default 0,
    claimed_at timestamptz,
    created_by uuid default auth.uid() references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists studio_social_posts_due_idx
    on public.studio_social_posts (scheduled_at) where status = 'scheduled';
create index if not exists studio_social_posts_created_idx
    on public.studio_social_posts (created_at desc);

alter table public.studio_social_posts enable row level security;

drop policy if exists "Admins manage studio social posts" on public.studio_social_posts;
create policy "Admins manage studio social posts" on public.studio_social_posts
    for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- The token lives here, and only the service role reaches it.
create table if not exists public.studio_social_accounts (
    platform text primary key check (platform in ('instagram')),
    ig_user_id text not null,
    access_token text not null,
    token_expires_at timestamptz,
    username text,
    updated_at timestamptz not null default now()
);

alter table public.studio_social_accounts enable row level security;
-- Deliberately no policies. Belt and braces: no grants to client roles either.
revoke all on public.studio_social_accounts from anon, authenticated;

-- What the Studio may know about the connection: never the token.
create or replace function public.studio_social_account_status(p_platform text default 'instagram')
returns table (connected boolean, username text, token_expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'admin only' using errcode = '42501';
    end if;
    return query
        select true, a.username, a.token_expires_at
        from public.studio_social_accounts a
        where a.platform = p_platform;
    if not found then
        return query select false, null::text, null::timestamptz;
    end if;
end;
$$;

revoke all on function public.studio_social_account_status(text) from public, anon;
grant execute on function public.studio_social_account_status(text) to authenticated;

-- Private bucket: Instagram fetches the files through short-lived signed URLs
-- the function makes. 100 MB a file covers a 60 s 1080×1920 reel.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-social', 'studio-social', false, 104857600, array['image/jpeg', 'video/mp4'])
on conflict (id) do nothing;

-- Every operation needs its own policy, including SELECT (storage runs
-- INSERT … RETURNING on upload, and upsert needs to read the row).
drop policy if exists "Admins read studio social" on storage.objects;
create policy "Admins read studio social" on storage.objects
    for select to authenticated using (bucket_id = 'studio-social' and (select public.is_admin()));

drop policy if exists "Admins upload studio social" on storage.objects;
create policy "Admins upload studio social" on storage.objects
    for insert to authenticated with check (bucket_id = 'studio-social' and (select public.is_admin()));

drop policy if exists "Admins update studio social" on storage.objects;
create policy "Admins update studio social" on storage.objects
    for update to authenticated using (bucket_id = 'studio-social' and (select public.is_admin()))
    with check (bucket_id = 'studio-social' and (select public.is_admin()));

drop policy if exists "Admins delete studio social" on storage.objects;
create policy "Admins delete studio social" on storage.objects
    for delete to authenticated using (bucket_id = 'studio-social' and (select public.is_admin()));

-- Every 5 minutes: publish what's due. Same gate as the other cron functions.
do $job$
begin
  perform cron.unschedule('studio-publish-instagram');
exception when others then
  null;
end
$job$;

select cron.schedule(
  'studio-publish-instagram',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/publish-instagram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{"due":true}'::jsonb,
    timeout_milliseconds := 30000
  )
  $cron$
);
