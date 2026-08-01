-- Automated internal weekly report. The database aggregates one exact UTC
-- reporting window and the previous equal window, returning a presentation-
-- ready JSON snapshot. Email and admin views render this snapshot rather than
-- reducing unbounded source rows in a browser or relying on handwritten copy.

alter table public.team_letters
  add column report_data jsonb not null default '{}'::jsonb,
  add column generated_at timestamptz,
  add column generation_version integer not null default 1;

create or replace function public.team_letter_report_metric(
  p_key text,
  p_label text,
  p_value numeric,
  p_previous numeric,
  p_format text default 'number'
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'key', p_key,
    'label', p_label,
    'value', coalesce(p_value, 0),
    'previous', p_previous,
    'delta_pct', case
      when p_previous is null then null
      when p_previous = 0 and coalesce(p_value, 0) = 0 then 0
      when p_previous = 0 then 100
      else round(((coalesce(p_value, 0) - p_previous) / abs(p_previous)) * 100, 1)
    end,
    'format', p_format
  );
$$;

create or replace function public.generate_team_letter_report(
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select
    p_start::timestamp at time zone 'UTC' as starts_at,
    (p_end + 1)::timestamp at time zone 'UTC' as ends_at,
    p_start - (p_end - p_start + 1) as previous_start,
    p_start - 1 as previous_end
  where p_end >= p_start and p_end - p_start between 0 and 30
), movement_current as (
  select
    count(*)::numeric as sessions,
    count(distinct s.user_id)::numeric as active_members,
    count(*) filter (
      where s.type::text not in ('sleep', 'walking') and not coalesce(s.flagged, false)
    )::numeric as trusted_workouts,
    coalesce(sum(s.duration_sec), 0)::numeric / 3600 as hours,
    coalesce(avg(s.duration_sec), 0)::numeric / 60 as average_minutes,
    coalesce(avg(s.trust_score), 0)::numeric * 100 as average_trust,
    count(*) filter (where s.flagged)::numeric as flagged,
    coalesce(sum(s.distance_m), 0)::numeric / 1000 as distance_km,
    coalesce(sum(s.steps), 0)::numeric as steps
  from activity_sessions s, params p
  where s.started_at >= p.starts_at and s.started_at < p.ends_at
), movement_previous as (
  select
    count(*)::numeric as sessions,
    count(distinct s.user_id)::numeric as active_members,
    count(*) filter (
      where s.type::text not in ('sleep', 'walking') and not coalesce(s.flagged, false)
    )::numeric as trusted_workouts,
    coalesce(sum(s.duration_sec), 0)::numeric / 3600 as hours,
    coalesce(avg(s.duration_sec), 0)::numeric / 60 as average_minutes,
    coalesce(avg(s.trust_score), 0)::numeric * 100 as average_trust,
    count(*) filter (where s.flagged)::numeric as flagged,
    coalesce(sum(s.distance_m), 0)::numeric / 1000 as distance_km,
    coalesce(sum(s.steps), 0)::numeric as steps
  from activity_sessions s, params p
  where s.started_at >= p.starts_at - (p.ends_at - p.starts_at)
    and s.started_at < p.starts_at
), members_current as (
  select count(*)::numeric as new_members
  from profiles m, params p
  where m.created_at >= p.starts_at and m.created_at < p.ends_at
), members_previous as (
  select count(*)::numeric as new_members
  from profiles m, params p
  where m.created_at >= p.starts_at - (p.ends_at - p.starts_at)
    and m.created_at < p.starts_at
), app_current as (
  select
    count(*)::numeric as events,
    count(*) filter (where event_type = 'screen_view')::numeric as screen_views,
    count(*) filter (where event_type = 'tap')::numeric as taps,
    count(distinct user_id)::numeric as users,
    count(distinct session_id)::numeric as app_sessions
  from app_events e, params p
  where e.created_at >= p.starts_at and e.created_at < p.ends_at
), app_previous as (
  select
    count(*)::numeric as events,
    count(*) filter (where event_type = 'screen_view')::numeric as screen_views,
    count(*) filter (where event_type = 'tap')::numeric as taps,
    count(distinct user_id)::numeric as users,
    count(distinct session_id)::numeric as app_sessions
  from app_events e, params p
  where e.created_at >= p.starts_at - (p.ends_at - p.starts_at)
    and e.created_at < p.starts_at
), points_current as (
  select
    coalesce(sum(amount) filter (where amount > 0), 0)::numeric as issued,
    coalesce(-sum(amount) filter (where amount < 0), 0)::numeric as spent,
    coalesce(sum(amount), 0)::numeric as net,
    count(*)::numeric as transactions
  from point_transactions t, params p
  where t.created_at >= p.starts_at and t.created_at < p.ends_at
), points_previous as (
  select
    coalesce(sum(amount) filter (where amount > 0), 0)::numeric as issued,
    coalesce(-sum(amount) filter (where amount < 0), 0)::numeric as spent,
    coalesce(sum(amount), 0)::numeric as net,
    count(*)::numeric as transactions
  from point_transactions t, params p
  where t.created_at >= p.starts_at - (p.ends_at - p.starts_at)
    and t.created_at < p.starts_at
), rewards_current as (
  select
    count(*)::numeric as redemptions,
    coalesce(sum(powr_spent), 0)::numeric as powr_spent,
    count(*) filter (where status = 'used' or used_at is not null)::numeric as used
  from redemptions r, params p
  where r.redeemed_at >= p.starts_at and r.redeemed_at < p.ends_at
), rewards_previous as (
  select
    count(*)::numeric as redemptions,
    coalesce(sum(powr_spent), 0)::numeric as powr_spent,
    count(*) filter (where status = 'used' or used_at is not null)::numeric as used
  from redemptions r, params p
  where r.redeemed_at >= p.starts_at - (p.ends_at - p.starts_at)
    and r.redeemed_at < p.starts_at
), challenges_current as (
  select
    count(*)::numeric as completions,
    count(distinct user_id)::numeric as members,
    coalesce(sum(points_awarded), 0)::numeric as points
  from user_challenge_completions c, params p
  where c.completed_at >= p.starts_at and c.completed_at < p.ends_at
), challenges_previous as (
  select
    count(*)::numeric as completions,
    count(distinct user_id)::numeric as members,
    coalesce(sum(points_awarded), 0)::numeric as points
  from user_challenge_completions c, params p
  where c.completed_at >= p.starts_at - (p.ends_at - p.starts_at)
    and c.completed_at < p.starts_at
), shared_current as (
  select
    (select count(*) from shared_challenges c, params p where c.created_at >= p.starts_at and c.created_at < p.ends_at)::numeric as started,
    (select count(*) from shared_challenge_participants c, params p where c.joined_at >= p.starts_at and c.joined_at < p.ends_at)::numeric as joined,
    (select count(*) from shared_challenges c, params p where c.settled_at >= p.starts_at and c.settled_at < p.ends_at)::numeric as settled
), shared_previous as (
  select
    (select count(*) from shared_challenges c, params p where c.created_at >= p.starts_at - (p.ends_at - p.starts_at) and c.created_at < p.starts_at)::numeric as started,
    (select count(*) from shared_challenge_participants c, params p where c.joined_at >= p.starts_at - (p.ends_at - p.starts_at) and c.joined_at < p.starts_at)::numeric as joined,
    (select count(*) from shared_challenges c, params p where c.settled_at >= p.starts_at - (p.ends_at - p.starts_at) and c.settled_at < p.starts_at)::numeric as settled
), partners_current as (
  select
    count(*)::numeric as sessions,
    count(distinct s.user_id)::numeric as members,
    count(distinct s.partner_id)::numeric as active_venues,
    coalesce(avg(s.duration_sec), 0)::numeric / 60 as average_minutes,
    count(*) filter (where s.flagged)::numeric as flagged
  from activity_sessions s, params p
  where s.started_at >= p.starts_at and s.started_at < p.ends_at
    and s.partner_id is not null
), partners_previous as (
  select
    count(*)::numeric as sessions,
    count(distinct s.user_id)::numeric as members,
    count(distinct s.partner_id)::numeric as active_venues,
    coalesce(avg(s.duration_sec), 0)::numeric / 60 as average_minutes,
    count(*) filter (where s.flagged)::numeric as flagged
  from activity_sessions s, params p
  where s.started_at >= p.starts_at - (p.ends_at - p.starts_at)
    and s.started_at < p.starts_at
    and s.partner_id is not null
), visits_current as (
  select count(*)::numeric as visits,
    count(*) filter (where claimed_session_id is not null)::numeric as claimed
  from gym_visits v, params p
  where v.started_at >= p.starts_at and v.started_at < p.ends_at
), visits_previous as (
  select count(*)::numeric as visits,
    count(*) filter (where claimed_session_id is not null)::numeric as claimed
  from gym_visits v, params p
  where v.started_at >= p.starts_at - (p.ends_at - p.starts_at)
    and v.started_at < p.starts_at
), support_current as (
  select
    (select count(*) from support_tickets t, params p where t.created_at >= p.starts_at and t.created_at < p.ends_at)::numeric as opened,
    (select count(*) from support_tickets t, params p where t.updated_at >= p.starts_at and t.updated_at < p.ends_at and t.status in ('resolved', 'closed'))::numeric as resolved,
    (select count(*) from support_tickets where status in ('open', 'in_progress'))::numeric as backlog,
    (select count(*) from reward_submissions where status = 'pending')::numeric as pending_rewards,
    (select count(*) from reward_submissions t, params p where t.submitted_at >= p.starts_at and t.submitted_at < p.ends_at)::numeric as reward_submissions
), support_previous as (
  select
    (select count(*) from support_tickets t, params p where t.created_at >= p.starts_at - (p.ends_at - p.starts_at) and t.created_at < p.starts_at)::numeric as opened,
    (select count(*) from support_tickets t, params p where t.updated_at >= p.starts_at - (p.ends_at - p.starts_at) and t.updated_at < p.starts_at and t.status in ('resolved', 'closed'))::numeric as resolved,
    (select count(*) from reward_submissions t, params p where t.submitted_at >= p.starts_at - (p.ends_at - p.starts_at) and t.submitted_at < p.starts_at)::numeric as reward_submissions
), push_current as (
  select count(*)::numeric as attempted,
    count(*) filter (where status = 'accepted')::numeric as accepted,
    count(*) filter (where status = 'rejected')::numeric as rejected,
    count(*) filter (where status = 'skipped')::numeric as skipped
  from push_send_log l, params p
  where l.created_at >= p.starts_at and l.created_at < p.ends_at
), push_previous as (
  select count(*)::numeric as attempted,
    count(*) filter (where status = 'accepted')::numeric as accepted,
    count(*) filter (where status = 'rejected')::numeric as rejected,
    count(*) filter (where status = 'skipped')::numeric as skipped
  from push_send_log l, params p
  where l.created_at >= p.starts_at - (p.ends_at - p.starts_at)
    and l.created_at < p.starts_at
), event_current as (
  select
    (select count(*) from live_events e, params p where e.window_start_at < p.ends_at and e.window_end_at >= p.starts_at and e.status <> 'draft')::numeric as events,
    (select count(*) from live_event_participants e, params p where e.joined_at >= p.starts_at and e.joined_at < p.ends_at)::numeric as joins
), event_previous as (
  select
    (select count(*) from live_events e, params p where e.window_start_at < p.starts_at and e.window_end_at >= p.starts_at - (p.ends_at - p.starts_at) and e.status <> 'draft')::numeric as events,
    (select count(*) from live_event_participants e, params p where e.joined_at >= p.starts_at - (p.ends_at - p.starts_at) and e.joined_at < p.starts_at)::numeric as joins
), snapshots as (
  select
    (select count(*) from profiles)::numeric as total_members,
    (select count(*) from profiles where active_health_provider is not null and active_health_provider <> 'none')::numeric as health_connected,
    (select count(*) from profiles where is_pro)::numeric as pro_members,
    (select count(distinct user_id) from user_push_tokens)::numeric as push_reachable,
    (select count(*) from partners where active)::numeric as directory_venues,
    (select count(*) from partner_locations l join partners p on p.id = l.partner_id where p.active)::numeric as directory_locations
)
select jsonb_build_object(
  'version', 1,
  'generated_at', now(),
  'window', jsonb_build_object(
    'start', p_start,
    'end', p_end,
    'previous_start', (select previous_start from params),
    'previous_end', (select previous_end from params)
  ),
  'headline', jsonb_build_array(
    team_letter_report_metric('active_members', 'Active members', mc.active_members, mp.active_members),
    team_letter_report_metric('trusted_workouts', 'Trusted workouts', mc.trusted_workouts, mp.trusted_workouts),
    team_letter_report_metric('app_sessions', 'App sessions', ac.app_sessions, ap.app_sessions),
    team_letter_report_metric('points_issued', 'POWR issued', pc.issued, pp.issued, 'points'),
    team_letter_report_metric('partner_sessions', 'Partner sessions', pac.sessions, pap.sessions),
    team_letter_report_metric('redemptions', 'Redemptions', rc.redemptions, rp.redemptions)
  ),
  'trend', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', d.day::date,
      'workouts', (select count(*) from activity_sessions s where s.started_at >= d.day and s.started_at < d.day + interval '1 day' and s.type::text not in ('sleep', 'walking') and not coalesce(s.flagged, false)),
      'app_sessions', (select count(distinct e.session_id) from app_events e where e.created_at >= d.day and e.created_at < d.day + interval '1 day')
    ) order by d.day)
    from generate_series(
      p_start::timestamp at time zone 'UTC',
      p_end::timestamp at time zone 'UTC',
      interval '1 day'
    ) as d(day)
  ), '[]'::jsonb),
  'sections', jsonb_build_array(
    jsonb_build_object(
      'key', 'members', 'title', 'Members & reach', 'accent', '#0EA5E9',
      'metrics', jsonb_build_array(
        team_letter_report_metric('total_members', 'Total members', s.total_members, null),
        team_letter_report_metric('new_members', 'New members', nc.new_members, np.new_members),
        team_letter_report_metric('active_members', 'Active movers', mc.active_members, mp.active_members),
        team_letter_report_metric('health_connected', 'Health connected', s.health_connected, null),
        team_letter_report_metric('push_reachable', 'Push reachable', s.push_reachable, null),
        team_letter_report_metric('pro_members', 'Pro members', s.pro_members, null)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', provider, 'value', users) order by users desc) from (
        select coalesce(nullif(active_health_provider, ''), 'none') as provider, count(*) as users
        from profiles group by 1 order by 2 desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'Health provider adoption'
    ),
    jsonb_build_object(
      'key', 'product', 'title', 'Product engagement', 'accent', '#8B5CF6',
      'metrics', jsonb_build_array(
        team_letter_report_metric('app_users', 'Product users', ac.users, ap.users),
        team_letter_report_metric('app_sessions', 'App sessions', ac.app_sessions, ap.app_sessions),
        team_letter_report_metric('screen_views', 'Screen views', ac.screen_views, ap.screen_views),
        team_letter_report_metric('taps', 'Tracked actions', ac.taps, ap.taps),
        team_letter_report_metric('screens_per_session', 'Screens / session', round(ac.screen_views / greatest(ac.app_sessions, 1), 1), round(ap.screen_views / greatest(ap.app_sessions, 1), 1), 'decimal'),
        team_letter_report_metric('events', 'Analytics events', ac.events, ap.events)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', screen, 'value', views) order by views desc) from (
        select coalesce(nullif(regexp_replace(route, '/\\([^)]+\\)', '', 'g'), ''), 'Home') as screen, count(*) as views
        from app_events e, params p where e.created_at >= p.starts_at and e.created_at < p.ends_at and e.event_type = 'screen_view'
        group by 1 order by 2 desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'Most viewed screens',
      'secondary_bars', coalesce((select jsonb_agg(jsonb_build_object('label', action, 'value', taps) order by taps desc) from (
        select target as action, count(*) as taps from app_events e, params p
        where e.created_at >= p.starts_at and e.created_at < p.ends_at and e.event_type = 'tap' and target is not null
        group by target order by taps desc limit 6
      ) x), '[]'::jsonb),
      'secondary_bar_label', 'Top actions'
    ),
    jsonb_build_object(
      'key', 'movement', 'title', 'Movement & trust', 'accent', '#10B981',
      'metrics', jsonb_build_array(
        team_letter_report_metric('sessions', 'All sessions', mc.sessions, mp.sessions),
        team_letter_report_metric('trusted_workouts', 'Trusted workouts', mc.trusted_workouts, mp.trusted_workouts),
        team_letter_report_metric('hours', 'Recorded hours', round(mc.hours, 1), round(mp.hours, 1), 'hours'),
        team_letter_report_metric('average_minutes', 'Avg duration', round(mc.average_minutes), round(mp.average_minutes), 'minutes'),
        team_letter_report_metric('average_trust', 'Avg trust', round(mc.average_trust, 1), round(mp.average_trust, 1), 'percent'),
        team_letter_report_metric('flagged_rate', 'Flagged rate', round(mc.flagged / greatest(mc.sessions, 1) * 100, 1), round(mp.flagged / greatest(mp.sessions, 1) * 100, 1), 'percent'),
        team_letter_report_metric('distance_km', 'Distance', round(mc.distance_km), round(mp.distance_km), 'km'),
        team_letter_report_metric('steps', 'Steps', mc.steps, mp.steps)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', activity, 'value', sessions) order by sessions desc) from (
        select type::text as activity, count(*) as sessions from activity_sessions a, params p
        where a.started_at >= p.starts_at and a.started_at < p.ends_at group by type order by sessions desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'Activity mix',
      'secondary_bars', coalesce((select jsonb_agg(jsonb_build_object('label', method, 'value', sessions) order by sessions desc) from (
        select verification::text as method, count(*) as sessions from activity_sessions a, params p
        where a.started_at >= p.starts_at and a.started_at < p.ends_at group by verification order by sessions desc limit 6
      ) x), '[]'::jsonb),
      'secondary_bar_label', 'Verification mix'
    ),
    jsonb_build_object(
      'key', 'economy', 'title', 'POWR economy & rewards', 'accent', '#E8D200',
      'metrics', jsonb_build_array(
        team_letter_report_metric('issued', 'POWR issued', pc.issued, pp.issued, 'points'),
        team_letter_report_metric('spent', 'POWR spent', pc.spent, pp.spent, 'points'),
        team_letter_report_metric('net', 'Net flow', pc.net, pp.net, 'points'),
        team_letter_report_metric('transactions', 'Transactions', pc.transactions, pp.transactions),
        team_letter_report_metric('redemptions', 'Redemptions', rc.redemptions, rp.redemptions),
        team_letter_report_metric('redemption_powr', 'Redemption POWR', rc.powr_spent, rp.powr_spent, 'points'),
        team_letter_report_metric('used', 'Codes used', rc.used, rp.used)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', source, 'value', amount) order by amount desc) from (
        select coalesce(nullif(source, ''), 'other') as source, sum(abs(amount)) as amount from point_transactions t, params p
        where t.created_at >= p.starts_at and t.created_at < p.ends_at group by 1 order by 2 desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'POWR flow by source',
      'secondary_bars', coalesce((select jsonb_agg(jsonb_build_object('label', reward, 'value', claims) order by claims desc) from (
        select coalesce(nullif(reward_title, ''), nullif(partner_name, ''), 'Reward') as reward, count(*) as claims
        from redemptions r, params p where r.redeemed_at >= p.starts_at and r.redeemed_at < p.ends_at
        group by 1 order by 2 desc limit 6
      ) x), '[]'::jsonb),
      'secondary_bar_label', 'Top claimed rewards'
    ),
    jsonb_build_object(
      'key', 'challenges', 'title', 'Challenges & social', 'accent', '#F97316',
      'metrics', jsonb_build_array(
        team_letter_report_metric('completions', 'Weekly completions', cc.completions, cp.completions),
        team_letter_report_metric('members', 'Members completing', cc.members, cp.members),
        team_letter_report_metric('points', 'Challenge POWR', cc.points, cp.points, 'points'),
        team_letter_report_metric('shared_started', 'Shared started', shc.started, shp.started),
        team_letter_report_metric('shared_joined', 'Participant joins', shc.joined, shp.joined),
        team_letter_report_metric('shared_settled', 'Shared completed', shc.settled, shp.settled)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', challenge, 'value', completions) order by completions desc) from (
        select challenge_id as challenge, count(*) as completions from user_challenge_completions c, params p
        where c.completed_at >= p.starts_at and c.completed_at < p.ends_at
        group by challenge_id order by completions desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'Most completed challenges'
    ),
    jsonb_build_object(
      'key', 'partners', 'title', 'Partners & places', 'accent', '#06B6D4',
      'metrics', jsonb_build_array(
        team_letter_report_metric('directory_venues', 'Directory venues', s.directory_venues, null),
        team_letter_report_metric('partner_sessions', 'Partner sessions', pac.sessions, pap.sessions),
        team_letter_report_metric('partner_members', 'Unique members', pac.members, pap.members),
        team_letter_report_metric('active_venues', 'Venues with activity', pac.active_venues, pap.active_venues),
        team_letter_report_metric('gym_visits', 'Detected visits', vc.visits, vp.visits),
        team_letter_report_metric('claimed_visits', 'Visits claimed', vc.claimed, vp.claimed),
        team_letter_report_metric('partner_average', 'Avg session', round(pac.average_minutes), round(pap.average_minutes), 'minutes'),
        team_letter_report_metric('partner_flagged', 'Flagged sessions', pac.flagged, pap.flagged)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', venue, 'value', sessions) order by sessions desc) from (
        select coalesce(p.name, 'Unknown venue') as venue, count(*) as sessions
        from activity_sessions a join partners p on p.id = a.partner_id, params x
        where a.started_at >= x.starts_at and a.started_at < x.ends_at
        group by p.id, p.name order by sessions desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'Busiest venues'
    ),
    jsonb_build_object(
      'key', 'operations', 'title', 'Operations & delivery', 'accent', '#F43F5E',
      'metrics', jsonb_build_array(
        team_letter_report_metric('support_opened', 'Tickets opened', sc.opened, sp.opened),
        team_letter_report_metric('support_resolved', 'Tickets resolved', sc.resolved, sp.resolved),
        team_letter_report_metric('support_backlog', 'Support backlog', sc.backlog, null),
        team_letter_report_metric('reward_submissions', 'Reward submissions', sc.reward_submissions, sp.reward_submissions),
        team_letter_report_metric('pending_rewards', 'Pending rewards', sc.pending_rewards, null),
        team_letter_report_metric('push_attempted', 'Push attempts', puc.attempted, pup.attempted),
        team_letter_report_metric('push_accepted', 'Push accepted', puc.accepted, pup.accepted),
        team_letter_report_metric('push_rejected', 'Push rejected', puc.rejected, pup.rejected),
        team_letter_report_metric('push_skipped', 'Push skipped', puc.skipped, pup.skipped),
        team_letter_report_metric('live_events', 'Live events', ec.events, ep.events),
        team_letter_report_metric('event_joins', 'Event joins', ec.joins, ep.joins)
      ),
      'bars', coalesce((select jsonb_agg(jsonb_build_object('label', type, 'value', sends) order by sends desc) from (
        select type, count(*) as sends from push_send_log l, params p
        where l.created_at >= p.starts_at and l.created_at < p.ends_at
        group by type order by sends desc limit 6
      ) x), '[]'::jsonb),
      'bar_label', 'Push volume by type'
    )
  )
)
from movement_current mc
cross join movement_previous mp
cross join members_current nc
cross join members_previous np
cross join app_current ac
cross join app_previous ap
cross join points_current pc
cross join points_previous pp
cross join rewards_current rc
cross join rewards_previous rp
cross join challenges_current cc
cross join challenges_previous cp
cross join shared_current shc
cross join shared_previous shp
cross join partners_current pac
cross join partners_previous pap
cross join visits_current vc
cross join visits_previous vp
cross join support_current sc
cross join support_previous sp
cross join push_current puc
cross join push_previous pup
cross join event_current ec
cross join event_previous ep
cross join snapshots s;
$$;

revoke all on function public.team_letter_report_metric(text, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.generate_team_letter_report(date, date) from public, anon, authenticated;
grant execute on function public.team_letter_report_metric(text, text, numeric, numeric, text) to service_role;
grant execute on function public.generate_team_letter_report(date, date) to service_role;

comment on function public.generate_team_letter_report(date, date) is
  'Builds a presentation-ready internal weekly report snapshot for one exact UTC date window and the previous equal window.';