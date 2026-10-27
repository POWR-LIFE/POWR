-- The Series board, live.
--
-- get_series_board sums point_transactions on every call, so the board is
-- always current when asked. Until now the app only asked once a minute.
-- This tells every open board the moment a point lands: an AFTER INSERT
-- trigger on point_transactions broadcasts a tick on the public Realtime
-- topic 'series-board' (realtime.send), and the app re-reads its board
-- within a couple of seconds (useSeriesBoard in lib/api/series.ts).
--
-- The tick carries nothing: no member, no amount, no session. Anyone can
-- listen to it and learn only that someone, somewhere, earned points.
-- Earn and streak rows only — what the Series ledger counts. A broadcast
-- that fails must never cost anyone their points, hence the exception block.
--
-- Also: the health_bg_delivery switch. While 'on' (the default) the app asks
-- HealthKit to wake it the moment a workout or a night is written and syncs
-- straight away (lib/health/healthKitObserver). 'off' stands that down on
-- every phone at its next foreground, with no release.

create or replace function public._series_board_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type in ('earn', 'streak') then
    begin
      perform realtime.send(jsonb_build_object('at', now()), 'tick', 'series-board', false);
    exception when others then
      null; -- the points are the job; the tick is a courtesy
    end;
  end if;
  return null;
end;
$$;

revoke all on function public._series_board_tick() from public, anon, authenticated;

-- 'zz' so it runs after the cap and race guards: a refused insert sends no tick.
drop trigger if exists trg_zz_series_board_tick on public.point_transactions;
create trigger trg_zz_series_board_tick
  after insert on public.point_transactions
  for each row execute function public._series_board_tick();

insert into public.system_config (key, value, description)
values (
  'health_bg_delivery',
  'on',
  'When on, iOS wakes the app the moment Apple Health records a workout or sleep and it syncs at once. Off clears those registrations on every phone at its next foreground.'
)
on conflict (key) do nothing;

-- system_config SELECT is otherwise admin-only; the app must read this key.
drop policy if exists "Authenticated can read health bg delivery" on public.system_config;
create policy "Authenticated can read health bg delivery"
  on public.system_config for select
  to authenticated
  using (key = 'health_bg_delivery');
