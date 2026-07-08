-- Points summary aggregate RPC.
--
-- The app previously computed balance / today / weekly / total earned by
-- downloading the user's ENTIRE point_transactions history (four separate
-- full scans per screen mount) and summing client-side. This returns all
-- four aggregates in one round-trip, summed in SQL.
--
-- Day/week/month boundaries are passed in by the client so its existing
-- semantics (local midnight, Monday-start week) are preserved exactly —
-- the server never guesses the user's timezone.

create or replace function public.get_my_points_summary(
  p_today_start timestamptz,
  p_week_start timestamptz,
  p_month_start timestamptz default null
)
returns table (
  balance bigint,
  today_earned bigint,
  weekly_earned bigint,
  monthly_earned bigint,
  total_earned bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(amount), 0)::bigint as balance,
    coalesce(sum(amount) filter (
      where type in ('earn', 'adjustment') and created_at >= p_today_start
    ), 0)::bigint as today_earned,
    coalesce(sum(amount) filter (
      where type in ('earn', 'adjustment') and created_at >= p_week_start
    ), 0)::bigint as weekly_earned,
    coalesce(sum(amount) filter (
      where p_month_start is not null
        and type in ('earn', 'adjustment')
        and created_at >= p_month_start
    ), 0)::bigint as monthly_earned,
    coalesce(sum(amount) filter (where amount > 0), 0)::bigint as total_earned
  from public.point_transactions
  where user_id = auth.uid();
$$;

revoke execute on function public.get_my_points_summary(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_my_points_summary(timestamptz, timestamptz, timestamptz) to authenticated;
