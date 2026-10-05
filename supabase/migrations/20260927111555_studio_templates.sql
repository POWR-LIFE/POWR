-- Blueprint templates: Studio templates written as DATA (see
-- landing-page/src/studio/blueprint/schema.js), published by the weekly
-- "Studio trend drop" routine — one new template a week, following the
-- week's trends — and loaded by the admin Studio into its "Trending" group
-- without a deploy. The routine runs the same checkBlueprint() before it
-- inserts; the Studio checks again when it loads and skips any that fail.
-- Admins can hide one from the Trends tab (status 'hidden').
create table if not exists public.studio_templates (
    id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text not null,
    trend text,
    week_start date,
    blueprint jsonb not null,
    status text not null default 'live' check (status in ('live', 'hidden')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists studio_templates_week_idx on public.studio_templates (week_start desc);

alter table public.studio_templates enable row level security;

drop policy if exists "Admins manage studio templates" on public.studio_templates;
create policy "Admins manage studio templates" on public.studio_templates
    for all to authenticated
    using ((select is_admin()))
    with check ((select is_admin()));

revoke all on public.studio_templates from anon;
grant select, insert, update, delete on public.studio_templates to authenticated;
