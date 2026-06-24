-- Pooled ("combined total") challenges (scope §3B). A template's `mode` decides
-- whether it's solo co-op (everyone hits their OWN goal — AND) or pooled
-- (contributions SUM toward one shared target). The challenge instance carries
-- kind='pooled' + a pool rule + per-participant `contribution`.
alter table public.shared_challenge_templates
  add column if not exists mode text not null default 'solo'
    check (mode in ('solo', 'pooled'));

-- Per-participant raw contribution toward the shared pool (steps/metres/sessions).
alter table public.shared_challenge_participants
  add column if not exists contribution numeric not null default 0;

-- Re-create get_my_shared_challenges to also return each participant's
-- contribution (needed to render the pooled total + per-person split).
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
$$;

revoke execute on function public.get_my_shared_challenges() from public, anon;
grant execute on function public.get_my_shared_challenges() to authenticated;

-- Seed a few pooled ("combined total") presets.
insert into public.shared_challenge_templates (category, title, tier, base_points, goal, measure, mode, sort_order)
values
  ('walking', '100K Together', 'medium', 35, 'Together: 100,000 steps',
     '{"measure":"steps_week","target":100000,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 10),
  ('running', 'Distance Pool', 'medium', 40, 'Together: 100km running',
     '{"measure":"distance","target":100,"unit":"km","days":null,"window":null}'::jsonb, 'pooled', 11),
  ('gym', 'Gym Pile-Up', 'easy', 30, 'Together: 20 gym check-ins',
     '{"measure":"checkins","target":20,"unit":null,"days":null,"window":"any"}'::jsonb, 'pooled', 12)
on conflict do nothing;
