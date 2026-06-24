-- ============================================================================
-- FRIEND GRAPH (scope §4) — the v1 backbone for shared "together" challenges.
-- One canonical row per friendship (user_id < friend_id), so a pair can never
-- have two rows. Clients READ their own rows via RLS; ALL writes go through the
-- service-role `manage-friendship` edge function (which also fires push), so
-- there are deliberately no client INSERT/UPDATE/DELETE policies.
-- ============================================================================

create table if not exists public.friendships (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  friend_id    uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','blocked')),
  requested_by uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, friend_id),
  -- Canonical ordering: the low id is always user_id. The edge function sorts
  -- the pair before writing, so this is an invariant, not a runtime surprise.
  constraint friendships_canonical_order check (user_id < friend_id)
);

create index if not exists idx_friendships_friend on public.friendships (friend_id);

alter table public.friendships enable row level security;

-- You can read any friendship row you're part of (either side of the pair).
create policy "read own friendships"
  on public.friendships for select
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- ── Read helper: my friendships, with the OTHER person's profile joined ──────
-- One call returns everything the Friends screen buckets into
-- friends / incoming / outgoing — the hook decides direction from
-- (status, requested_by) without ever reasoning about canonical ordering.
create or replace function public.get_my_friendships()
returns table (
  friend_user_id uuid,
  username       text,
  display_name   text,
  avatar_url     text,
  status         text,
  requested_by   uuid,
  created_at     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when f.user_id = auth.uid() then f.friend_id else f.user_id end as friend_user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.status,
    f.requested_by,
    f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  where auth.uid() in (f.user_id, f.friend_id)
    and f.status <> 'blocked';
$$;

grant execute on function public.get_my_friendships() to authenticated;

-- ── Username search (scope §4 Option 3) ─────────────────────────────────────
-- Discovery by exact-ish @username / display name. Excludes yourself and anyone
-- you already share a friendship row with (any status — so blocked/pending
-- people don't resurface). Returns at most 20.
create or replace function public.search_profiles_by_username(q text)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where p.id <> auth.uid()
    and length(btrim(q)) >= 2
    and (p.username ilike '%' || btrim(q) || '%'
         or p.display_name ilike '%' || btrim(q) || '%')
    and not exists (
      select 1 from public.friendships f
      where (f.user_id = least(auth.uid(), p.id) and f.friend_id = greatest(auth.uid(), p.id))
    )
  order by
    (lower(p.username) = lower(btrim(q))) desc,  -- exact username first
    p.username
  limit 20;
$$;

grant execute on function public.search_profiles_by_username(text) to authenticated;

-- Keep these helpers off the anon REST surface (project 0028 lockdown).
revoke execute on function public.get_my_friendships()              from public, anon;
revoke execute on function public.search_profiles_by_username(text) from public, anon;
