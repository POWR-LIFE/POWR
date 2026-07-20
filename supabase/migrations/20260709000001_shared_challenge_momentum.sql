-- Shared-challenge "so far today" momentum.
--
-- Parallel goals like "10k steps, 4 days" show a days-count (0 / 4) that stays
-- at 0 until you cross the daily bar — giving no credit for a day in progress.
-- We now persist a per-participant momentum figure (today's partial toward the
-- daily/window bar, or the running weekly sum) so the card can show
-- "Today 2,567 / 10,000" alongside the honest day-count.
--
-- Written by evaluateParticipant (both the optimistic complete-shared-challenge
-- path and the resolve-shared-challenges cron backstop). Shape:
--   { "current": 2567, "target": 10000, "unit": "steps" }  -- or null.
--
-- Both list RPCs gain the column in their per-participant jsonb; adding a nested
-- key doesn't change the RPC signature, but get_my_shared_challenges /
-- get_shared_challenge are recreated wholesale here to stay the single source of
-- their body. DROP+CREATE (not CREATE OR REPLACE — the return type is unchanged
-- but recreating keeps both bodies identical), and the anon-revoke must be
-- re-applied (Supabase default privileges re-grant anon EXECUTE on CREATE —
-- 0028/0029 lockdown posture is authenticated + service_role only).

alter table public.shared_challenge_participants
  add column if not exists momentum jsonb;

-- ── List RPC ────────────────────────────────────────────────────────────────

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
                'momentum', sp.momentum,
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

-- ── Durable single-challenge lookup (old notification links / history) ───────

drop function if exists public.get_shared_challenge(uuid);

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
                'momentum', sp.momentum,
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
