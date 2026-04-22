-- =============================================================
-- Lightweight GROUP BY aggregate for admin code stats.
-- Returns one row per status with count.
-- Replaces the old full table scan + JS count.
-- =============================================================
create or replace function public.get_code_stats(p_reward_id uuid)
returns table (status text, cnt bigint)
language sql
security definer
stable
as $$
  select status, count(*)::bigint as cnt
    from public.redemption_codes
   where reward_id = p_reward_id
   group by status;
$$;

revoke all on function public.get_code_stats(uuid) from public, anon;
grant execute on function public.get_code_stats(uuid) to authenticated;
