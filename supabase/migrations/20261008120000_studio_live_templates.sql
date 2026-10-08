-- The week's Trending templates for every portal's Studio, not just the
-- admin's: gym staff and reward-brand users get the LIVE blueprints the
-- weekly trend routine published (landing-page/src/studio/trending.js).
-- studio_templates stays admin-only; this returns only what the editor draws
-- from. The `trend` write-up names other brands' campaigns, so it stays out.
-- Hiding a template on the admin Trends tab (status 'hidden') takes it out of
-- every portal.
create or replace function public.studio_live_templates()
returns table (id text, name text, week_start date, blueprint jsonb)
language sql
stable
security definer
set search_path = public
as $$
    select t.id, t.name, t.week_start, t.blueprint
    from public.studio_templates t
    where t.status = 'live'
      and (
          (select is_admin())
          or exists (select 1 from public.gym_staff s where s.user_id = auth.uid())
          or exists (select 1 from public.reward_brand_users u where u.user_id = auth.uid())
      )
    order by t.week_start desc nulls last, t.created_at desc
    limit 60;
$$;

revoke all on function public.studio_live_templates() from public, anon;
grant execute on function public.studio_live_templates() to authenticated;
