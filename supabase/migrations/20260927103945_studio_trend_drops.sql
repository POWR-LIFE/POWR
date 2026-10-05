-- Studio trend drops: what the big fitness/wellness brands' campaign creative
-- looks like right now, turned into things the Studio can make. Written by
-- the "Studio trend drop" routine (a scheduled cloud agent, via the Supabase
-- connector) and read by the admin Studio's Trends tab. Admin-only: it names
-- other brands and links their campaigns.
--
-- trends      [{ name, strength 1–3, what, fit: 'look'|'template'|'photo',
--               examples: [{ brand, campaign, date, url, image }],
--               avoid,                    -- what would be copying
--               look: {…} | null,         -- Studio look keys (mono, tint, tintAmount, fade, grain…)
--               template: { id, fields } | null,  -- an existing template to try it on
--               idea: text | null }]      -- a new template worth building
-- post_ideas  [{ title, template, fields, look, why }]
-- shot_list   [text]  what to photograph for these looks
-- sources     [{ label, url }]
create table if not exists public.studio_trend_drops (
    id uuid primary key default gen_random_uuid(),
    week_start date not null unique,
    title text not null,
    summary text,
    trends jsonb not null default '[]'::jsonb,
    post_ideas jsonb not null default '[]'::jsonb,
    shot_list jsonb not null default '[]'::jsonb,
    sources jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.studio_trend_drops enable row level security;

drop policy if exists "Admins manage studio trend drops" on public.studio_trend_drops;
create policy "Admins manage studio trend drops" on public.studio_trend_drops
    for all to authenticated
    using ((select is_admin()))
    with check ((select is_admin()));

revoke all on public.studio_trend_drops from anon;
grant select, insert, update, delete on public.studio_trend_drops to authenticated;
