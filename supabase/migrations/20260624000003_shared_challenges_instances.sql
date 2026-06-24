-- ============================================================================
-- SHARED CHALLENGE INSTANCES + PARTICIPANTS.
-- A challenge someone created and invited friends into. Lifecycle:
--   forming  → invitees still deciding; clock OFF (ends_at null), accept_by ticking
--   active   → everyone accepted (or window resolved with ≥2); clock running
--   completed→ ended + bonus settled
--   cancelled→ resolved with <2 in; expired → legacy/no-completion path
-- Template + derived rule + bonus config are SNAPSHOTTED at creation so admin
-- edits never mutate a live challenge. Clients READ via RLS; all writes go
-- through service-role edge functions. base_awarded/bonus_awarded on the
-- participant row are the idempotency guards (mirror complete-weekly-challenge).
-- ============================================================================

create table if not exists public.shared_challenges (
  id             uuid primary key default gen_random_uuid(),
  creator_id     uuid not null references public.profiles(id) on delete cascade,
  kind           text not null default 'parallel' check (kind in ('parallel','pooled','synchronized','versus')),
  template       jsonb not null,        -- snapshot: {id,category,title,tier,goal,base_points,measure}
  rule           jsonb not null,        -- snapshot: derived rule-engine Rule
  category       text not null,
  base_points    int not null,
  status         text not null default 'forming'
                   check (status in ('forming','active','completed','expired','cancelled')),
  duration_hours int not null,
  accept_by      timestamptz,           -- response deadline (while forming)
  starts_at      timestamptz,           -- clock start (all accepted / window resolved)
  ends_at        timestamptz,           -- starts_at + duration (null while forming)
  bonus_per_head int not null,          -- snapshot of config at creation
  bonus_max      int not null,
  settled_at     timestamptz,           -- when the end-of-challenge bonus settlement ran
  created_at     timestamptz not null default now()
);

create index if not exists idx_shared_challenges_status on public.shared_challenges (status);
create index if not exists idx_shared_challenges_accept_by on public.shared_challenges (accept_by) where status = 'forming';
create index if not exists idx_shared_challenges_ends_at on public.shared_challenges (ends_at) where status = 'active';

create table if not exists public.shared_challenge_participants (
  challenge_id  uuid not null references public.shared_challenges(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  state         text not null default 'invited'
                  check (state in ('invited','accepted','declined','completed','left')),
  invited_by    uuid references public.profiles(id),
  progress      numeric not null default 0,   -- 0..1 cache for the UI
  completed     boolean not null default false,
  base_awarded  boolean not null default false,
  bonus_awarded int not null default 0,
  completed_at  timestamptz,
  joined_at     timestamptz,
  created_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index if not exists idx_scp_user on public.shared_challenge_participants (user_id, state);

alter table public.shared_challenges enable row level security;
alter table public.shared_challenge_participants enable row level security;

-- Membership test as SECURITY DEFINER so the participants RLS policy can call it
-- without recursing into its own row-level checks.
create or replace function public.is_challenge_participant(p_challenge uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shared_challenge_participants
    where challenge_id = p_challenge
      and user_id = p_user
      and state not in ('declined','left')
  );
$$;

create policy "participants read their challenges"
  on public.shared_challenges for select
  using (creator_id = auth.uid() or public.is_challenge_participant(id, auth.uid()));

create policy "participants read co-participants"
  on public.shared_challenge_participants for select
  using (public.is_challenge_participant(challenge_id, auth.uid()));

-- ── Read helper: everything the Home/detail screens need in one call ─────────
-- Returns challenges the caller is involved in (not declined/left), with the
-- full participant list (profiles joined) as a jsonb array. Completed ones are
-- kept briefly so the celebration overlay can fire, then drop off.
create or replace function public.get_my_shared_challenges()
returns table (
  id             uuid,
  creator_id     uuid,
  kind           text,
  template       jsonb,
  category       text,
  base_points    int,
  status         text,
  duration_hours int,
  accept_by      timestamptz,
  starts_at      timestamptz,
  ends_at        timestamptz,
  bonus_per_head int,
  bonus_max      int,
  settled_at     timestamptz,
  created_at     timestamptz,
  participants   jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.creator_id, c.kind, c.template, c.category, c.base_points, c.status,
    c.duration_hours, c.accept_by, c.starts_at, c.ends_at, c.bonus_per_head,
    c.bonus_max, c.settled_at, c.created_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id', sp.user_id,
                'username', p.username,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'state', sp.state,
                'progress', sp.progress,
                'completed', sp.completed,
                'is_self', sp.user_id = auth.uid()
              ) order by (sp.user_id = c.creator_id) desc, sp.created_at)
       from public.shared_challenge_participants sp
       join public.profiles p on p.id = sp.user_id
       where sp.challenge_id = c.id
         and sp.state not in ('declined','left')),
      '[]'::jsonb
    ) as participants
  from public.shared_challenges c
  where exists (
    select 1 from public.shared_challenge_participants me
    where me.challenge_id = c.id
      and me.user_id = auth.uid()
      and me.state not in ('declined','left')
  )
  and (
    c.status in ('forming','active')
    or (c.status = 'completed' and c.settled_at > now() - interval '3 days')
  )
  order by c.created_at desc;
$$;

grant execute on function public.get_my_shared_challenges() to authenticated;

-- Keep helpers off the anon REST surface (project 0028 lockdown).
revoke execute on function public.is_challenge_participant(uuid, uuid) from public, anon;
revoke execute on function public.get_my_shared_challenges()          from public, anon;
