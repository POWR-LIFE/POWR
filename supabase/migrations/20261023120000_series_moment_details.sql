-- Home needs a little more about each moment: which activities a Double Down
-- boosts (the ×2 badge on that ring) and All In's top N (whether you're
-- outside it). Applies after 20261023090000_series_moments.sql.

create or replace function public.get_series_moments(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           case when m.secret and now() < m.starts_at
                then jsonb_build_object('id', m.id, 'kind', 'secret', 'name', null, 'line', null,
                                        'starts_at', null, 'ends_at', null, 'multiplier', null,
                                        'activities', null, 'top_n', null)
                else jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'line', m.line,
                                        'starts_at', m.starts_at, 'ends_at', m.ends_at, 'multiplier', m.multiplier,
                                        'activities', m.activities, 'top_n', m.top_n)
           end order by m.starts_at), '[]'::jsonb)
    from public.series_moments m
    join public.series_rounds r on r.id = m.round_id
   where r.slug = p_slug and (r.published or public.is_admin());
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261023120000', 'series_moment_details')
on conflict (version) do nothing;
