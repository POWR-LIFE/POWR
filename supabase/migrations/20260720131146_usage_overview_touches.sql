-- Report positioned touches separately. 'events' alone hid them, and counting
-- them as taps would have made scrolling look like engagement.
--
-- screens_per_session divides by sessions that HAVE a screen view rather than
-- by every session: a session with only touches (possible if the buffer flushed
-- mid-launch) would otherwise drag the average down for no real reason.
create or replace function public.admin_usage_overview(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_out   jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select jsonb_build_object(
    'events',        count(*),
    'screen_views',  count(*) filter (where event_type = 'screen_view'),
    'taps',          count(*) filter (where event_type = 'tap'),
    'touches',       count(*) filter (where event_type = 'touch'),
    'users',         count(distinct user_id),
    'app_sessions',  count(distinct session_id),
    'screens_per_session',
      round(
        count(*) filter (where event_type = 'screen_view')::numeric
        / greatest(count(distinct session_id) filter (where event_type = 'screen_view'), 1)
      , 1)
  )
  into v_out
  from app_events
  where created_at >= v_since;

  return v_out;
end;
$$;

revoke all on function public.admin_usage_overview(int) from public, anon;
grant execute on function public.admin_usage_overview(int) to authenticated;
