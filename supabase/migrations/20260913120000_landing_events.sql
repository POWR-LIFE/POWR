-- Public, read-only list of live events for the marketing homepage.
--
-- Two kinds of row, one rule each:
--   current — the app's own visibility rule from get_active_live_event():
--             not draft, not archived, not hidden, ended < 7 days ago.
--   past    — the track record: events that actually ran to a reveal
--             (revealed_at set) with a real field (5+ participants).
--             `hidden` is NOT a criterion here: admins hide finished events
--             to clear the League tab, and test events are unhidden, so it
--             says nothing about whether an event was real.
-- Never drafts, never previewer-only rows, no per-member data (participants
-- is a count). House SECURITY DEFINER pattern: pinned search_path, EXECUTE
-- revoked from PUBLIC by name, granted to anon + authenticated.

create or replace function public.landing_events()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(x) order by x.window_start_at desc), '[]'::json)
  from (
    select
      e.slug,
      e.name,
      e.status,
      e.window_start_at,
      e.window_end_at,
      e.doors_open_at,
      e.prizes,
      e.logo_url,
      p.name       as venue,
      p.logo_url   as venue_logo,
      p.address    as venue_address,
      c.participants,
      (e.hidden = false
         and e.status not in ('draft', 'archived')
         and e.window_end_at > now() - interval '7 days') as is_current
    from live_events e
    left join partners p on p.id = e.venue_partner_id
    cross join lateral (
      select count(*) as participants
      from live_event_participants lp
      where lp.event_id = e.id and lp.disqualified_at is null
    ) c
    where e.status <> 'draft'
      and (
        -- current
        (e.hidden = false and e.status <> 'archived' and e.window_end_at > now() - interval '7 days')
        or
        -- past, and real
        (e.revealed_at is not null and e.window_end_at < now() and c.participants >= 5)
      )
    order by e.window_start_at desc
    limit 12
  ) x;
$$;

revoke all on function public.landing_events() from public;
grant execute on function public.landing_events() to anon, authenticated;
