-- Completed-challenge dismissal + durable by-id lookup.
--
-- 1. `dismissed_at` on the participant row: a completed challenge lingers on
--    Home for 3 days post-settlement (the settlement/share moment); the (X) on
--    the card lets a user clear it early — per-user, so one person dismissing
--    never touches anyone else's Home. Display preference only: the challenge
--    stays in the list payload (detail links keep resolving inside the window);
--    the client just hides dismissed cards from the Home carousel.
--
-- 2. get_shared_challenge(p_id): single-challenge fetch with NO settled-age
--    cutoff, for challenges the caller participated in. Notification feed rows
--    deep-link to /shared-challenge?id=… forever, but the list RPC drops
--    completed challenges after 3 days — so those links dead-ended on
--    "Challenge not available". The detail screen now falls back to this when
--    the challenge isn't in the list, making history (and its Share) durable.
--
-- get_my_shared_challenges gains a return column (the caller's dismissed_at),
-- which changes the signature → DROP + CREATE (CREATE OR REPLACE can't change
-- return types). Grants re-applied: authenticated + service_role, anon revoked
-- (0028/0029 lockdown — default privileges re-grant anon on CREATE).

alter table public.shared_challenge_participants
  add column if not exists dismissed_at timestamptz;

drop function if exists public.get_my_shared_challenges();

create function public.get_my_shared_challenges()
returns table(
  id uuid, creator_id uuid, kind text, template jsonb, rule jsonb, category text,
  base_points integer, status text, duration_hours integer,
  accept_by timestamptz, starts_at timestamptz, ends_at timestamptz,
  bonus_per_head integer, bonus_max integer, settled_at timestamptz,
  created_at timestamptz, dismissed_at timestamptz, participants jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    c.id, c.creator_id, c.kind, c.template, c.rule, c.category, c.base_points, c.status,
    c.duration_hours, c.accept_by, c.starts_at, c.ends_at, c.bonus_per_head,
    c.bonus_max, c.settled_at, c.created_at,
    (select me.dismissed_at from public.shared_challenge_participants me
      where me.challenge_id = c.id and me.user_id = auth.uid()) as dismissed_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id', sp.user_id,
                'username', p.username,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'state', sp.state,
                'progress', sp.progress,
                'completed', sp.completed,
                'contribution', sp.contribution,
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
$function$;

revoke all on function public.get_my_shared_challenges() from public;
revoke execute on function public.get_my_shared_challenges() from anon;
grant execute on function public.get_my_shared_challenges() to authenticated, service_role;

-- ── Durable single-challenge lookup ─────────────────────────────────────────
-- Identical row shape to the list RPC (one client mapper serves both). Gated to
-- challenges the caller was live in (declined/left stay hidden, matching the
-- list); deliberately NO status or settled-age cutoff — this is the reference
-- path for history.

create function public.get_shared_challenge(p_id uuid)
returns table(
  id uuid, creator_id uuid, kind text, template jsonb, rule jsonb, category text,
  base_points integer, status text, duration_hours integer,
  accept_by timestamptz, starts_at timestamptz, ends_at timestamptz,
  bonus_per_head integer, bonus_max integer, settled_at timestamptz,
  created_at timestamptz, dismissed_at timestamptz, participants jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    c.id, c.creator_id, c.kind, c.template, c.rule, c.category, c.base_points, c.status,
    c.duration_hours, c.accept_by, c.starts_at, c.ends_at, c.bonus_per_head,
    c.bonus_max, c.settled_at, c.created_at,
    (select me.dismissed_at from public.shared_challenge_participants me
      where me.challenge_id = c.id and me.user_id = auth.uid()) as dismissed_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id', sp.user_id,
                'username', p.username,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'state', sp.state,
                'progress', sp.progress,
                'completed', sp.completed,
                'contribution', sp.contribution,
                'is_self', sp.user_id = auth.uid()
              ) order by (sp.user_id = c.creator_id) desc, sp.created_at)
       from public.shared_challenge_participants sp
       join public.profiles p on p.id = sp.user_id
       where sp.challenge_id = c.id
         and sp.state not in ('declined','left')),
      '[]'::jsonb
    ) as participants
  from public.shared_challenges c
  where c.id = p_id
    and exists (
      select 1 from public.shared_challenge_participants me
      where me.challenge_id = c.id
        and me.user_id = auth.uid()
        and me.state not in ('declined','left')
    );
$function$;

revoke all on function public.get_shared_challenge(uuid) from public;
revoke execute on function public.get_shared_challenge(uuid) from anon;
grant execute on function public.get_shared_challenge(uuid) to authenticated, service_role;
