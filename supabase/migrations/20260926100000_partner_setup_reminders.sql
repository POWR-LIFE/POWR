-- Partner setup reminder — plumbing only. Nothing here sends: the daily cron
-- lives in 20260926100100_partner_setup_reminders_go_live.sql.
--
-- A brand that was invited (or approved) and has not finished setting up after
-- 5 days gets ONE nudge per stage:
--   invite   — the portal setup link was never used (no reward_brand_users)
--   delivery — a login exists, a reward is approved, but nothing is live and
--              there is no route for codes (no method, no codes, no Shopify,
--              no mint endpoint), and nobody has ever claimed from the brand
--
-- 1. partner_setup_reminder_log — dedupe, one row per (brand, stage)
-- 2. get_partner_setup_reminder_candidates(p_days) — who is due today

-- ── 1. Dedupe log ────────────────────────────────────────────────────────────
create table if not exists public.partner_setup_reminder_log (
  brand_key text        not null,   -- lower(trim(brand_name))
  stage     text        not null check (stage in ('invite', 'delivery')),
  email     text        not null,
  sent_at   timestamptz not null default now(),
  primary key (brand_key, stage)
);

alter table public.partner_setup_reminder_log enable row level security;
-- No policies: service-role only.

-- ── 2. Candidates ────────────────────────────────────────────────────────────
create or replace function public.get_partner_setup_reminder_candidates(p_days int default 5)
returns table (
  brand_name    text,
  brand_key     text,
  stage         text,
  email         text,
  contact_name  text,
  invite_token  text,
  reward_title  text,
  logo_url      text,
  brand_color   text,
  days_since    int
)
language sql
stable
security definer
set search_path = public
as $$
  with latest_reward as (
    -- Newest reward per brand: title + look for the email.
    select distinct on (lower(trim(r.brand_name)))
           lower(trim(r.brand_name)) as brand_key,
           r.title, r.image_url, r.brand_color
    from public.rewards r
    where r.brand_name is not null
    order by lower(trim(r.brand_name)), r.created_at desc
  ),
  latest_submission as (
    -- The partner's own submission carries the contact name.
    select distinct on (lower(trim(s.brand_name)))
           lower(trim(s.brand_name)) as brand_key,
           s.contact_name
    from public.reward_submissions s
    where s.brand_name is not null and s.status <> 'invited'
    order by lower(trim(s.brand_name)), s.updated_at desc nulls last, s.created_at desc
  ),
  brand_state as (
    select lower(trim(r.brand_name)) as brand_key,
           count(*) filter (where r.active) as live_rewards,
           count(*) as rewards
    from public.rewards r
    where r.brand_name is not null
    group by lower(trim(r.brand_name))
  ),
  route as (
    -- Any way at all for codes to reach members.
    select b.brand_key,
           exists (select 1 from public.reward_brand_integrations g
                   where lower(trim(g.brand_name)) = b.brand_key
                     and (g.delivery_method is not null or g.mint_url is not null)) as method_chosen,
           exists (select 1 from public.reward_brand_shopify sh
                   where lower(trim(sh.brand_name)) = b.brand_key and sh.status = 'connected') as shopify,
           exists (select 1 from public.redemption_codes c
                   join public.rewards r on r.id = c.reward_id
                   where lower(trim(r.brand_name)) = b.brand_key
                     and c.status = 'available'
                     and (c.expires_at is null or c.expires_at > now())) as codes,
           exists (select 1 from public.redemptions d
                   join public.rewards r on r.id = d.reward_id
                   where lower(trim(r.brand_name)) = b.brand_key) as ever_claimed
    from brand_state b
  ),
  -- Stage 1: invited, never set up.
  invite_due as (
    select distinct on (lower(trim(i.brand_name)))
           i.brand_name,
           lower(trim(i.brand_name)) as brand_key,
           'invite'::text as stage,
           i.email,
           i.invite_token,
           i.created_at as anchor
    from public.reward_brand_invites i
    where i.status = 'invited'
      and i.email is not null
      and i.created_at <= now() - make_interval(days => p_days)
      and not exists (select 1 from public.reward_brand_users u
                      where lower(trim(u.brand_name)) = lower(trim(i.brand_name)))
    order by lower(trim(i.brand_name)), i.created_at desc
  ),
  -- Stage 2: logged in, approved, no route, nothing live, never claimed.
  -- Emails the brand's first (oldest) login; the anchor is that login's date.
  delivery_due as (
    select distinct on (lower(trim(u.brand_name)))
           u.brand_name,
           lower(trim(u.brand_name)) as brand_key,
           'delivery'::text as stage,
           au.email::text as email,
           null::text as invite_token,
           u.created_at as anchor
    from public.reward_brand_users u
    join auth.users au on au.id = u.user_id
    join brand_state b on b.brand_key = lower(trim(u.brand_name))
    join route rt on rt.brand_key = b.brand_key
    where au.email is not null
      and b.rewards > 0
      and b.live_rewards = 0
      and not rt.method_chosen and not rt.shopify and not rt.codes and not rt.ever_claimed
      and u.created_at <= now() - make_interval(days => p_days)
    order by lower(trim(u.brand_name)), u.created_at asc
  ),
  due as (
    select * from invite_due
    union all
    select * from delivery_due
  )
  select d.brand_name,
         d.brand_key,
         d.stage,
         d.email,
         ls.contact_name,
         d.invite_token,
         lr.title,
         lr.image_url,
         lr.brand_color,
         greatest(1, floor(extract(epoch from (now() - d.anchor)) / 86400))::int as days_since
  from due d
  left join latest_reward lr on lr.brand_key = d.brand_key
  left join latest_submission ls on ls.brand_key = d.brand_key
  where not exists (select 1 from public.partner_setup_reminder_log l
                    where l.brand_key = d.brand_key and l.stage = d.stage)
  order by d.stage, d.brand_name;
$$;

revoke all on function public.get_partner_setup_reminder_candidates(int) from public, anon, authenticated;
grant execute on function public.get_partner_setup_reminder_candidates(int) to service_role;
