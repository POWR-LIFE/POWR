-- Partner setup reminder → weekly, until the brand's side is done.
--
-- 20260926100000 sent each brand at most ONE email per stage (invite,
-- delivery), five days in, then went quiet. Healthspan Elite made its login on
-- 09-28 and on 10-08 still had no codes and had heard nothing since: its only
-- claim (a refunded placeholder) also kept it out of the delivery stage.
--
-- Now one email per brand per week while its setup is unfinished. The first
-- goes 5 days after the brand started waiting, then every 7 days, at most 8.
-- "Unfinished" is the first of the brand's own steps it hasn't done:
--   login    invited, no portal login yet
--   submit   logged in, no approved reward, nothing waiting on our review
--   choose   reward approved, no way chosen for codes to reach members
--   connect  way chosen, but no code can reach a member yet (empty pool,
--            Shopify not connected, no mint endpoint)
-- Once codes can flow, the next move is ours (switch the reward on), so the
-- brand stops hearing from us. Never for a brand that is live, or that has
-- had a real claim (refunded ones don't count).
--
-- It goes to everyone on the brand's side: portal logins, invite addresses and
-- the submission contact. Healthspan's login is a shared Gmail; Cara's work
-- address is only on the invite and the submission. @powr.life addresses are
-- left out, so POWR's own test brands never get one.
--
-- The cron (partner-setup-reminder, daily 09:30 UTC) is unchanged. It calls
-- send-partner-setup-reminder, which asks this function who is due today.

-- ── 1. Log: one row per send, not one per stage ──────────────────────────────
alter table public.partner_setup_reminder_log
  drop constraint if exists partner_setup_reminder_log_pkey,
  drop constraint if exists partner_setup_reminder_log_stage_check,
  add column if not exists seq int,
  add column if not exists recipients text[] not null default '{}';

update public.partner_setup_reminder_log l
set seq = n.rn
from (
  select brand_key, stage, row_number() over (partition by brand_key order by sent_at) as rn
  from public.partner_setup_reminder_log
) n
where n.brand_key = l.brand_key and n.stage = l.stage and l.seq is null;

update public.partner_setup_reminder_log set recipients = array[email] where recipients = '{}';

alter table public.partner_setup_reminder_log
  alter column seq set not null,
  add primary key (brand_key, seq),
  -- invite/delivery are the old one-off stages, kept for the rows they wrote.
  add constraint partner_setup_reminder_log_stage_check
    check (stage in ('invite', 'delivery', 'login', 'submit', 'choose', 'connect'));

comment on column public.partner_setup_reminder_log.seq is
  'Nth reminder this brand has had (1 = first). The send claims (brand_key, seq) before mailing, so two runs can''t both send.';
comment on column public.partner_setup_reminder_log.email is
  'First recipient. Everyone it went to is in recipients.';

-- ── 2. Who is due today ──────────────────────────────────────────────────────
drop function if exists public.get_partner_setup_reminder_candidates(int);

create or replace function public.get_partner_setup_reminder_candidates(
  p_first_after_days int default 5,
  p_every_days       int default 7,
  p_max              int default 8
)
returns table (
  brand_name      text,
  brand_key       text,
  step            text,         -- login | submit | choose | connect
  recipients      text[],
  login_emails    text[],       -- the portal's own logins, so the email can say which to sign in with
  contact_name    text,
  invite_token    text,         -- login step: the still-valid setup link
  reward_title    text,
  logo_url        text,
  brand_color     text,
  method          text,         -- api | shopify | manual | null (not chosen)
  draft_title     text,         -- newest unsubmitted draft, if any
  draft_is_edit   boolean,      -- that draft edits a listing that already exists
  waiting_since   timestamptz,
  reminder_number int           -- the log seq this send claims (1 = first)
)
language sql
stable
security definer
set search_path = public
as $$
  with brand_keys as (
    select lower(trim(i.brand_name)) as brand_key
    from public.reward_brand_invites i
    where i.brand_name is not null and i.status in ('invited', 'used')
    union
    select lower(trim(u.brand_name))
    from public.reward_brand_users u
    where u.brand_name is not null
  ),
  logins as (
    select lower(trim(u.brand_name)) as brand_key,
           min(u.brand_name) as brand_name,
           min(u.created_at) as first_login
    from public.reward_brand_users u
    where u.brand_name is not null
    group by 1
  ),
  open_invite as (
    select distinct on (lower(trim(i.brand_name)))
           lower(trim(i.brand_name)) as brand_key,
           i.brand_name,
           i.invite_token::text as invite_token,
           i.created_at
    from public.reward_brand_invites i
    where i.status = 'invited' and i.email is not null and i.brand_name is not null
    order by lower(trim(i.brand_name)), i.created_at desc
  ),
  reward_state as (
    select lower(trim(r.brand_name)) as brand_key,
           count(*) as rewards,
           count(*) filter (where r.active) as live,
           coalesce(bool_or(r.integration_type = 'AFFILIATE'), false) as affiliate,
           max(r.created_at) as newest_reward_at
    from public.rewards r
    where r.brand_name is not null
    group by 1
  ),
  latest_reward as (
    -- Newest reward per brand: its title and look go in the email.
    select distinct on (lower(trim(r.brand_name)))
           lower(trim(r.brand_name)) as brand_key,
           r.brand_name, r.title, r.image_url, r.brand_color
    from public.rewards r
    where r.brand_name is not null
    order by lower(trim(r.brand_name)), r.created_at desc
  ),
  in_review as (
    -- A brand-new reward sent to us and not yet decided: our move, not theirs.
    select distinct lower(trim(s.brand_name)) as brand_key
    from public.reward_submissions s
    where s.status = 'pending' and s.target_reward_id is null and s.brand_name is not null
  ),
  latest_draft as (
    select distinct on (lower(trim(s.brand_name)))
           lower(trim(s.brand_name)) as brand_key,
           s.title,
           s.target_reward_id is not null as is_edit
    from public.reward_submissions s
    where s.status = 'draft' and s.brand_name is not null
    order by lower(trim(s.brand_name)), coalesce(s.updated_at, s.created_at) desc
  ),
  contact as (
    -- A draft saved halfway can have no contact yet, so take the newest named one.
    select distinct on (lower(trim(s.brand_name)))
           lower(trim(s.brand_name)) as brand_key,
           trim(s.contact_name) as contact_name
    from public.reward_submissions s
    where s.status <> 'invited' and s.brand_name is not null and nullif(trim(s.contact_name), '') is not null
    order by lower(trim(s.brand_name)), coalesce(s.updated_at, s.created_at) desc
  ),
  route as (
    select k.brand_key,
           g.delivery_method as method,
           -- Same test as the admin Vault's canMint: API JIT and Shopify both set it.
           coalesce(g.mint_enabled, false) as can_mint,
           exists (select 1 from public.reward_brand_shopify sh
                   where lower(trim(sh.brand_name)) = k.brand_key and sh.status = 'connected') as shopify,
           exists (select 1 from public.redemption_codes c
                   join public.rewards r on r.id = c.reward_id
                   where lower(trim(r.brand_name)) = k.brand_key
                     and c.status = 'available'
                     and (c.expires_at is null or c.expires_at > now())) as codes,
           exists (select 1 from public.redemptions d
                   join public.rewards r on r.id = d.reward_id
                   where lower(trim(r.brand_name)) = k.brand_key
                     and d.status <> 'refunded') as ever_claimed
    from brand_keys k
    left join public.reward_brand_integrations g on lower(trim(g.brand_name)) = k.brand_key
  ),
  people as (
    select lower(trim(u.brand_name)) as brand_key, lower(trim(au.email::text)) as email
    from public.reward_brand_users u
    join auth.users au on au.id = u.user_id
    union
    select lower(trim(i.brand_name)), lower(trim(i.email))
    from public.reward_brand_invites i
    where i.status in ('invited', 'used')
    union
    select lower(trim(s.brand_name)), lower(trim(s.contact_email))
    from public.reward_submissions s
    where s.status <> 'invited'
  ),
  recipients as (
    select p.brand_key, array_agg(distinct p.email order by p.email) as emails
    from people p
    where p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and p.email not like '%@powr.life'
    group by p.brand_key
  ),
  login_emails as (
    select lower(trim(u.brand_name)) as brand_key,
           array_agg(distinct lower(au.email::text) order by lower(au.email::text)) as emails
    from public.reward_brand_users u
    join auth.users au on au.id = u.user_id
    where au.email is not null and lower(au.email::text) not like '%@powr.life'
    group by 1
  ),
  state as (
    select k.brand_key,
           coalesce(lr.brand_name, l.brand_name, oi.brand_name) as brand_name,
           case
             when l.brand_key is null then
               case when oi.brand_key is not null then 'login' end
             when coalesce(rs.rewards, 0) = 0 then
               case when ir.brand_key is null then 'submit' end
             when not (rt.codes or rt.shopify or rt.can_mint or coalesce(rs.affiliate, false)) then
               case when rt.method is null then 'choose' else 'connect' end
           end as step,
           case
             when l.brand_key is null then oi.created_at
             else greatest(l.first_login, rs.newest_reward_at)
           end as waiting_since,
           oi.invite_token,
           rt.method
    from brand_keys k
    join route rt on rt.brand_key = k.brand_key
    left join logins l on l.brand_key = k.brand_key
    left join open_invite oi on oi.brand_key = k.brand_key
    left join reward_state rs on rs.brand_key = k.brand_key
    left join latest_reward lr on lr.brand_key = k.brand_key
    left join in_review ir on ir.brand_key = k.brand_key
    where coalesce(rs.live, 0) = 0
      and not rt.ever_claimed
  ),
  sends as (
    select l.brand_key, count(*) as n, max(l.seq) as last_seq, max(l.sent_at) as last_sent
    from public.partner_setup_reminder_log l
    group by l.brand_key
  )
  select s.brand_name,
         s.brand_key,
         s.step,
         rc.emails,
         coalesce(le.emails, '{}'),
         c.contact_name,
         case when s.step = 'login' then s.invite_token end,
         lr.title,
         lr.image_url,
         lr.brand_color,
         s.method,
         d.title,
         d.is_edit,
         s.waiting_since,
         (coalesce(sn.last_seq, 0) + 1)::int
  from state s
  join recipients rc on rc.brand_key = s.brand_key
  left join sends sn on sn.brand_key = s.brand_key
  left join latest_reward lr on lr.brand_key = s.brand_key
  left join latest_draft d on d.brand_key = s.brand_key
  left join contact c on c.brand_key = s.brand_key
  left join login_emails le on le.brand_key = s.brand_key
  where s.step is not null
    and coalesce(sn.n, 0) < p_max
    and case
          when sn.last_sent is null
            then s.waiting_since <= now() - make_interval(days => p_first_after_days)
          -- By calendar day, so a 09:30 run isn't pushed a day by the seconds
          -- the last one took.
          else (sn.last_sent at time zone 'UTC')::date
               <= (now() at time zone 'UTC')::date - p_every_days
        end
  order by s.brand_name;
$$;

revoke all on function public.get_partner_setup_reminder_candidates(int, int, int) from public, anon, authenticated;
grant execute on function public.get_partner_setup_reminder_candidates(int, int, int) to service_role;
