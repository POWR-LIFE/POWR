-- Expose the challenge `rule` (kind, target, category) through
-- get_my_shared_challenges so the client can render a concrete "X / Y" progress
-- readout (e.g. "1 / 3") on parallel challenges instead of an abstract "33%".
-- Adding a return column changes the signature, so DROP + CREATE is required
-- (CREATE OR REPLACE cannot change the return type). Grants are re-applied to
-- match the pre-existing ACL (authenticated + service_role; anon stays revoked
-- per the 0028/0029 security-definer lockdown — Supabase default privileges
-- re-grant anon on CREATE, so it must be revoked again explicitly).

drop function if exists public.get_my_shared_challenges();

create function public.get_my_shared_challenges()
returns table(
  id uuid, creator_id uuid, kind text, template jsonb, rule jsonb, category text,
  base_points integer, status text, duration_hours integer,
  accept_by timestamptz, starts_at timestamptz, ends_at timestamptz,
  bonus_per_head integer, bonus_max integer, settled_at timestamptz,
  created_at timestamptz, participants jsonb
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
