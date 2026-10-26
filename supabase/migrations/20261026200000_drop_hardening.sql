-- POWR Drop hardening, from the pre-commit review (2026-10-26).
--
-- 1. A day only moves forward. "Today" comes from profiles.timezone, which the
--    member's own device writes; switching it west used to reopen yesterday
--    with today's steps. _drop_today never goes behind the member's latest
--    Drop day, and a day's movement is always counted in the time zone it was
--    made in (drop_days.tz).
-- 2. The target settles before it freezes. The day's first read can come
--    before the app has backfilled missed days, so for 15 minutes after a day
--    is made, while it's sealed, get_my_drop re-plans it from fresh history
--    (_drop_refresh) — no Comeback for someone whose walks were still syncing.
-- 3. Comeback counts whole idle days: last moved Monday, Thursday is 2 days
--    away (it said 3, which met the threshold of 3 two idle days early).
-- 4. Vault access fails closed, a forced (reissued) Vault prize never reaches
--    someone outside the Vault rollout, and could-be-inside lists only what
--    the member can win.
-- 5. _drop_spent reads opened_at as a range, so the opened index serves it
--    inside the open lock.
-- Re-states _drop_spent, _drop_make_day, _drop_pay, get_my_drop and
-- open_my_drop (from 20261026180000 / 20261026190000).

-- Today's Drop day for the member, and the time zone it's counted in.
create or replace function public._drop_today(p_uid uuid, out tz text, out day date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day date;
  v_tz  text;
begin
  tz := public._drop_tz(p_uid);
  day := (now() at time zone tz)::date;
  select d.day, d.tz into v_day, v_tz
    from public.drop_days d
   where d.user_id = p_uid
   order by d.day desc
   limit 1;
  if v_day is not null and v_day >= day then
    day := v_day;
    tz := v_tz;
  end if;
end;
$$;

-- The target, basis and comeback for a member's day, from the 14 days before it.
create or replace function public._drop_plan(
  p_uid uuid,
  p_tz text,
  p_day date,
  out steps integer,
  out minutes integer,
  out basis text,
  out typical_steps integer,
  out typical_minutes integer,
  out comeback boolean,
  out days_away integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s    integer[];
  v_m    integer[];
  v_last date;
  t      record;
begin
  select array_agg(m.steps order by m.d), array_agg(m.minutes order by m.d)
    into v_s, v_m
    from public._drop_movement(p_uid, p_tz, p_day - 14, p_day - 1) m;

  select max(m.d) into v_last
    from public._drop_movement(p_uid, p_tz, p_day - 90, p_day - 1) m
   where m.steps > 0 or m.minutes > 0;
  -- Whole days with no movement between the last active day and today.
  days_away := case when v_last is null then null else p_day - v_last - 1 end;
  comeback := days_away is not null and days_away >= public._drop_num('drop_comeback_after_days', 3);

  select * into t from public._drop_target(v_s, v_m, comeback);
  steps := t.steps;
  minutes := t.minutes;
  basis := t.basis;
  typical_steps := t.typical_steps;
  typical_minutes := t.typical_minutes;
end;
$$;

-- For 15 minutes after a sealed day is made, re-plan it from fresh history.
create or replace function public._drop_refresh(p_id uuid)
returns public.drop_days
language plpgsql
security definer
set search_path = public
as $$
declare
  r  public.drop_days;
  pl record;
begin
  select * into r from public.drop_days where id = p_id;
  if r.status = 'sealed' and r.created_at > now() - interval '15 minutes' then
    select * into pl from public._drop_plan(r.user_id, r.tz, r.day);
    update public.drop_days
       set target_steps = pl.steps, target_minutes = pl.minutes, basis = pl.basis,
           typical_steps = pl.typical_steps, typical_minutes = pl.typical_minutes,
           comeback = pl.comeback, days_away = pl.days_away
     where id = r.id and status = 'sealed';
    select * into r from public.drop_days where id = p_id;
  end if;
  return r;
end;
$$;

-- POWR (now + Vault) all Drops have paid on a London day.
create or replace function public._drop_spent(p_day date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(prize_amount), 0)::integer
    from public.drop_days
   where status = 'opened'
     and prize_kind in ('points', 'vault')
     and opened_at >= (p_day::timestamp at time zone 'Europe/London')
     and opened_at <  ((p_day + 1)::timestamp at time zone 'Europe/London');
$$;

-- Today's row, made the first time it's asked for (target settled by _drop_refresh).
create or replace function public._drop_make_day(p_uid uuid, p_tz text, p_day date)
returns public.drop_days
language plpgsql
security definer
set search_path = public
as $$
declare
  t      record;
  r      public.drop_days;
begin
  select * into r from public.drop_days where user_id = p_uid and day = p_day;
  if found then
    return r;
  end if;

  select * into t from public._drop_plan(p_uid, p_tz, p_day);

  insert into public.drop_days
    (user_id, day, tz, target_steps, target_minutes, basis, typical_steps, typical_minutes, comeback, days_away)
  values
    (p_uid, p_day, p_tz, t.steps, t.minutes, t.basis, t.typical_steps, t.typical_minutes, t.comeback, t.days_away)
  on conflict (user_id, day) do nothing;

  select * into r from public.drop_days where user_id = p_uid and day = p_day;
  return r;
end;
$$;

-- Roll and pay a day's prize. The caller holds the day row's lock and the
-- open lock. p_force pays that prize (support reissue); otherwise a weighted
-- roll over the daily pool — leaving out what is off, out of date, out of
-- stock, over the budget, or a code the member can't take — then, when
-- nothing there can pay, the fallback pool. Returns the prize, or null.
create or replace function public._drop_pay(p_day_id uuid, p_force uuid default null, p_ignore_budget boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.drop_days;
  p        public.drop_prizes;
  v_budget numeric := public._drop_num('drop_daily_budget', 1000);
  v_spent  integer := public._drop_spent((now() at time zone 'Europe/London')::date);
  v_vault  boolean;
  v_pool   text;
  v_ids    uuid[];
  v_w      integer[];
  v_tried  uuid[] := '{}';
  v_total  integer;
  v_roll   float8;
  v_acc    integer;
  v_pick   uuid;
  v_paid   jsonb;
  i        integer;
begin
  select * into r from public.drop_days where id = p_day_id;
  begin
    v_vault := public.vault_has_access(r.user_id);
  exception when others then
    v_vault := false;
  end;

  foreach v_pool in array case when p_force is not null then array['forced'] else array['daily', 'fallback'] end
  loop
    loop
      if v_pool = 'forced' then
        exit when p_force = any (v_tried);
        v_ids := array[p_force];
        v_w := array[1];
      else
        select array_agg(x.id order by x.id), array_agg(x.weight order by x.id)
          into v_ids, v_w
          from public.drop_prizes x
         where x.pool = v_pool
           and x.active
           and (x.starts_at is null or x.starts_at <= now())
           and (x.ends_at is null or x.ends_at > now())
           and (x.stock is null or x.given < x.stock)
           and not (x.id = any (v_tried))
           and (x.kind <> 'vault' or v_vault)
           and (x.kind = 'partner' or v_pool = 'fallback' or p_ignore_budget or v_spent + x.amount <= v_budget)
           and (x.kind <> 'partner' or public._drop_partner_ok(r.user_id, x.reward_id));
        exit when v_ids is null;
      end if;

      select sum(w) into v_total from unnest(v_w) w;
      v_roll := random() * v_total;
      v_acc := 0;
      v_pick := v_ids[array_length(v_ids, 1)];
      for i in 1..array_length(v_ids, 1) loop
        v_acc := v_acc + v_w[i];
        if v_roll < v_acc then
          v_pick := v_ids[i];
          exit;
        end if;
      end loop;
      v_tried := v_tried || v_pick;

      select * into p from public.drop_prizes where id = v_pick for update;
      continue when not found or (p.stock is not null and p.given >= p.stock)
                         or (p.kind = 'vault' and not v_vault);
      v_paid := public._drop_give(r.user_id, p);
      continue when v_paid is null;

      update public.drop_prizes set given = given + 1 where id = p.id;
      update public.drop_days
         set status = 'opened',
             opened_at = now(),
             prize_id = p.id,
             prize_kind = p.kind,
             prize_amount = p.amount,
             prize_detail = v_paid->'detail',
             fallback = (v_pool = 'fallback'),
             reward_id = (v_paid->>'reward_id')::uuid,
             point_tx_id = (v_paid->>'point_tx_id')::uuid,
             vault_deposit_id = (v_paid->>'vault_deposit_id')::uuid,
             redemption_id = (v_paid->>'redemption_id')::uuid
       where id = r.id;
      return jsonb_build_object('kind', p.kind, 'amount', p.amount, 'fallback', v_pool = 'fallback')
             || coalesce(v_paid->'detail', '{}'::jsonb);
    end loop;
  end loop;
  return null;
end;
$$;

-- Today's Drop for the signed-in member, or null when it's off for them.
-- Makes today's row on first ask. Steps and minutes are the server's own
-- count, so call it after the app's step sync.
create or replace function public.get_my_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_today  date;
  r        public.drop_days;
  v_steps  integer;
  v_mins   integer;
  v_monday date;
  v_first  date;
  v_week   jsonb;
  v_inside jsonb;
  v_vault  boolean;
begin
  if not coalesce(public._drop_enabled_for(v_uid), false) then
    return null;
  end if;
  select t.tz, t.day into v_tz, v_today from public._drop_today(v_uid) t;
  r := public._drop_make_day(v_uid, v_tz, v_today);
  r := public._drop_refresh(r.id);
  v_tz := r.tz;
  begin
    v_vault := coalesce(public.vault_has_access(v_uid), false);
  exception when others then
    v_vault := false;
  end;

  select m.steps, m.minutes into v_steps, v_mins
    from public._drop_movement(v_uid, v_tz, v_today, v_today) m;

  -- Monday to yesterday: opened, missed, or none (before their first Drop).
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  select min(day) into v_first from public.drop_days where user_id = v_uid;
  select coalesce(jsonb_agg(
           case when dd.status = 'opened' then 'opened'
                when g.d < v_first then 'none'
                else 'missed' end
           order by g.d), '[]'::jsonb)
    into v_week
    from (select gs::date as d
            from generate_series(v_monday::timestamp, (v_today - 1)::timestamp, interval '1 day') gs) g
    left join public.drop_days dd on dd.user_id = v_uid and dd.day = g.d;

  -- What could be inside: the live daily prizes this member can win, best odds first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind, 'amount', x.amount, 'brand', x.brand, 'value_label', x.value_label, 'title', x.title)
           order by x.weight desc), '[]'::jsonb)
    into v_inside
    from (
      select * from (
        select distinct on (p.kind, p.amount, p.reward_id)
               p.kind, p.amount, p.weight,
               dsp->>'brand' as brand, dsp->>'value_label' as value_label, dsp->>'title' as title
          from public.drop_prizes p
          left join public.rewards rw on rw.id = p.reward_id
          left join lateral (select public._drop_reward_display(rw.id) as dsp) dd on rw.id is not null
         where p.pool = 'daily'
           and p.active
           and (p.kind <> 'vault' or v_vault)
           and (p.starts_at is null or p.starts_at <= now())
           and (p.ends_at is null or p.ends_at > now())
           and (p.stock is null or p.given < p.stock)
           and (p.kind <> 'partner' or (rw.active and (rw.expires_at is null or rw.expires_at > now())
                                        and coalesce(rw.integration_type::text, '') <> 'AFFILIATE'))
         order by p.kind, p.amount, p.reward_id, p.weight desc
      ) d
      order by d.weight desc
      limit 4
    ) x;

  return jsonb_build_object(
    'day',             v_today,
    'status',          r.status,
    'target',          jsonb_build_object('steps', r.target_steps, 'minutes', r.target_minutes, 'basis', r.basis,
                                          'typical_steps', r.typical_steps, 'typical_minutes', r.typical_minutes),
    'steps',           coalesce(v_steps, 0),
    'minutes',         coalesce(v_mins, 0),
    'prize',           public._drop_prize_json(r),
    'opened_at',       r.opened_at,
    'week',            v_week,
    'day_index',       extract(isodow from v_today)::integer - 1,
    'comeback',        case when r.comeback then jsonb_build_object('days_away', r.days_away) end,
    'could_be_inside', v_inside,
    'resets_at',       (v_today + 1)::timestamp at time zone v_tz
  );
end;
$$;

-- Open today's Drop. Safe to retry: an opened day returns the same prize.
-- { ok: true, prize, already } or { ok: false, reason: off | void | not_yet | empty }.
create or replace function public.open_my_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_tz    text;
  v_today date;
  r       public.drop_days;
  v_steps integer;
  v_mins  integer;
  v_prize jsonb;
begin
  if not coalesce(public._drop_enabled_for(v_uid), false) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  select t.tz, t.day into v_tz, v_today from public._drop_today(v_uid) t;
  perform public._drop_make_day(v_uid, v_tz, v_today);
  select * into r from public.drop_days where user_id = v_uid and day = v_today for update;
  v_tz := r.tz;

  if r.status = 'opened' then
    return jsonb_build_object('ok', true, 'already', true, 'prize', public._drop_prize_json(r));
  end if;
  if r.status = 'void' then
    return jsonb_build_object('ok', false, 'reason', 'void');
  end if;

  select m.steps, m.minutes into v_steps, v_mins
    from public._drop_movement(v_uid, v_tz, v_today, v_today) m;
  if coalesce(v_steps, 0) < r.target_steps and coalesce(v_mins, 0) < r.target_minutes then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'steps', coalesce(v_steps, 0), 'minutes', coalesce(v_mins, 0));
  end if;

  update public.drop_days set steps_at_open = coalesce(v_steps, 0), minutes_at_open = coalesce(v_mins, 0)
   where id = r.id;

  -- One open at a time across everyone, so the budget and stock hold exactly.
  perform pg_advisory_xact_lock(hashtext('powr_drop_open'));
  v_prize := public._drop_pay(r.id);
  if v_prize is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'prize', v_prize);
end;
$$;

revoke all on function public._drop_today(uuid) from public, anon, authenticated;
revoke all on function public._drop_plan(uuid, text, date) from public, anon, authenticated;
revoke all on function public._drop_refresh(uuid) from public, anon, authenticated;
revoke all on function public._drop_spent(date) from public, anon, authenticated;
revoke all on function public._drop_make_day(uuid, text, date) from public, anon, authenticated;
revoke all on function public._drop_pay(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_my_drop() from public, anon;
revoke all on function public.open_my_drop() from public, anon;
grant execute on function public.get_my_drop() to authenticated;
grant execute on function public.open_my_drop() to authenticated;
