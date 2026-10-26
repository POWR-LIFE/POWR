-- POWR Drop: "Could be inside" lists every live prize (up to 12), not the top 4.
-- The Home card now loops through them horizontally, so nothing is cut off.
-- Re-states get_my_drop from 20261026200000; the only change is the limit.

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

  -- What could be inside: the live daily prizes this member can win, best odds first
  -- (up to 12: the card loops through them all).
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
      limit 12
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

revoke all on function public.get_my_drop() from public, anon;
grant execute on function public.get_my_drop() to authenticated;
