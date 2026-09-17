-- =============================================================
-- WEEKLY SUMMARY EMAIL — extras
-- Additive companion to get_weekly_summary_recipients() (20260618000002),
-- merged by user_id in the send-weekly-summary edge function. Kept separate so
-- the recipient/eligibility query — the part that decides who gets mail — is
-- not touched to add presentation data.
--
--   days           the week's seven calendar days IN THE MEMBER'S TIMEZONE
--                  (profiles.timezone, IANA; UTC when unset/unknown), each with
--                  POWR earned + whether anything non-sleep was logged. Drives
--                  the M T W T F S S strip and "best day". Local days can sit a
--                  few hours either side of the UTC week, so a day's figure is
--                  what the member saw in-app, not a slice of the UTC total.
--   total_earned   the canonical level basis: positive ledger (all types) +
--                  unreleased Vault — same definition as get_my_points_summary.
--   vault_banked   unreleased Vault POWR, NULL unless vault_has_access(user):
--                  the Vault is a targeted rollout and must not be named to
--                  members who cannot open it.
--   is_first_week  joined on/after the previous week's start — nothing to
--                  compare against, so the email must not say "back in action".
--   longest_*      longest PLAUSIBLE workout. A gym visit whose exit never fired
--                  pins at the 12 h backstop; those are tracking artefacts, not
--                  achievements, so gym > 4 h and anything > 8 h is skipped and
--                  the next-longest session is featured instead.
-- =============================================================

create or replace function public.get_weekly_summary_extras(
  p_since timestamptz,
  p_until timestamptz
)
returns table (
  user_id         uuid,
  days            jsonb,
  total_earned    int,
  vault_banked    int,
  is_first_week   boolean,
  longest_sec     int,
  longest_type    text,
  longest_partner text
)
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select pr.id, pr.created_at, coalesce(tzn.name, 'UTC') as tz
    from public.profiles pr
    left join pg_catalog.pg_timezone_names tzn on tzn.name = pr.timezone
  ),
  cal as (
    select ((p_since at time zone 'UTC')::date + i) as d
    from generate_series(0, 6) as i
  ),
  pts as (
    select pt.user_id, (pt.created_at at time zone u.tz)::date as d, sum(pt.amount)::int as pts
    from public.point_transactions pt
    join u on u.id = pt.user_id
    where pt.type in ('earn', 'adjustment')
      and pt.created_at >= p_since - interval '14 hours'
      and pt.created_at <  p_until + interval '14 hours'
    group by 1, 2
  ),
  act as (
    select distinct s.user_id, (s.started_at at time zone u.tz)::date as d
    from public.activity_sessions s
    join u on u.id = s.user_id
    where s.type <> 'sleep'
      and coalesce(s.flagged, false) = false
      and s.started_at >= p_since - interval '14 hours'
      and s.started_at <  p_until + interval '14 hours'
  ),
  day_agg as (
    select
      x.user_id,
      jsonb_agg(
        jsonb_build_object(
          'date',   to_char(cal.d, 'YYYY-MM-DD'),
          'points', greatest(coalesce(pts.pts, 0), 0),
          'active', act.user_id is not null
        ) order by cal.d
      ) as days
    from (select user_id from pts union select user_id from act) x
    cross join cal
    left join pts on pts.user_id = x.user_id and pts.d = cal.d
    left join act on act.user_id = x.user_id and act.d = cal.d
    group by x.user_id
  ),
  earned as (
    select pt.user_id, coalesce(sum(pt.amount) filter (where pt.amount > 0), 0)::int as ledger
    from public.point_transactions pt
    group by pt.user_id
  ),
  vault as (
    select vd.user_id, coalesce(sum(vd.amount), 0)::int as pending
    from public.vault_deposits vd
    where vd.released_at is null
    group by vd.user_id
  ),
  longest as (
    select distinct on (s.user_id)
      s.user_id,
      s.duration_sec::int as sec,
      s.type::text        as type,
      p.name              as partner
    from public.activity_sessions s
    left join public.partners p on p.id = s.partner_id
    where s.started_at >= p_since and s.started_at < p_until
      and coalesce(s.flagged, false) = false
      and s.type not in ('sleep', 'walking')
      and s.duration_sec > 0
      and s.duration_sec <= case when s.type::text = 'gym' then 4 * 3600 else 8 * 3600 end
    order by s.user_id, s.duration_sec desc, s.started_at desc
  )
  select
    u.id                                                  as user_id,
    day_agg.days,
    (coalesce(earned.ledger, 0) + coalesce(vault.pending, 0))::int as total_earned,
    case when public.vault_has_access(u.id) then coalesce(vault.pending, 0) end as vault_banked,
    (u.created_at >= p_since - interval '7 days')         as is_first_week,
    longest.sec                                           as longest_sec,
    longest.type                                          as longest_type,
    longest.partner                                       as longest_partner
  from u
  join day_agg       on day_agg.user_id = u.id
  left join earned   on earned.user_id  = u.id
  left join vault    on vault.user_id   = u.id
  left join longest  on longest.user_id = u.id;
$$;

revoke all on function public.get_weekly_summary_extras(timestamptz, timestamptz)
  from public, anon, authenticated;
-- Service role only (it bypasses the revokes); the edge function calls this.
