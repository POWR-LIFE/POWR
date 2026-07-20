-- Admin-scheduled vault unlocks — "Vault Day" events.
--
-- An unlock event makes the targeted users' PENDING deposits READY at a
-- chosen moment (vests_at pulled to now at fire time) — it does not credit
-- anything itself, so users still get the press-and-hold unlock moment and
-- the existing claim/cron machinery handles the rest (grace-window backstop
-- included). Targets: all users, or a specific list (resolved from emails).
--
-- Events are one-shot: deposits banked AFTER an event fires are not
-- affected. Fired by process_vault_unlock_events(), which the
-- release-vault-deposits cron edge fn runs before its sweep (≤15 min
-- precision) and which returns the newly-ready users for the optional
-- "your Vault is ready" push.

create table public.vault_unlock_events (
  id              uuid primary key default gen_random_uuid(),
  unlock_at       timestamptz not null,
  target          text not null check (target in ('all', 'users')),
  user_ids        uuid[],            -- null for 'all'
  note            text,
  notify          boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  applied_at      timestamptz,       -- null = still scheduled
  affected_users  int,               -- stamped on apply
  affected_points int                -- stamped on apply
);

create index on public.vault_unlock_events (unlock_at) where applied_at is null;

alter table public.vault_unlock_events enable row level security;

create policy "Admins can read vault unlock events"
  on public.vault_unlock_events for select
  using (public.is_admin());

-- Writes only via the definer RPCs below.

-- The admin Vault page also shows economy stats (total vesting, ready now).
create policy "Admins can read all vault deposits"
  on public.vault_deposits for select
  using (public.is_admin());

-- ── Schedule (admin-gated) ───────────────────────────────────────────────────
-- p_emails null/empty → all users; otherwise resolved against auth.users.
-- Returns what resolved so the panel can surface typos immediately.

create or replace function public.admin_schedule_vault_unlock(
  p_unlock_at timestamptz,
  p_emails text[] default null,
  p_note text default null,
  p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   uuid := auth.uid();
  v_ids     uuid[];
  v_missing text[];
  v_target  text;
  v_id      uuid;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_unlock_at is null then
    raise exception 'unlock_at required';
  end if;

  if p_emails is null or coalesce(array_length(p_emails, 1), 0) = 0 then
    v_target := 'all';
  else
    v_target := 'users';
    select array_agg(u.id), null
      into v_ids
      from auth.users u
     where lower(u.email) = any (select lower(trim(e)) from unnest(p_emails) e where trim(e) <> '');
    select array_agg(e) into v_missing
      from (select lower(trim(e)) as e from unnest(p_emails) e where trim(e) <> '') src
     where not exists (select 1 from auth.users u where lower(u.email) = src.e);
    if v_ids is null then
      raise exception 'NO_USERS_RESOLVED';
    end if;
  end if;

  insert into vault_unlock_events (unlock_at, target, user_ids, note, notify, created_by)
  values (p_unlock_at, v_target, v_ids, nullif(trim(coalesce(p_note, '')), ''), p_notify, v_admin)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'target', v_target,
    'resolved_users', coalesce(array_length(v_ids, 1), 0),
    'missing_emails', to_jsonb(coalesce(v_missing, array[]::text[]))
  );
end;
$$;

revoke all on function public.admin_schedule_vault_unlock(timestamptz, text[], text, boolean) from public, anon;
grant execute on function public.admin_schedule_vault_unlock(timestamptz, text[], text, boolean) to authenticated;

-- ── Cancel (admin-gated, scheduled events only) ──────────────────────────────

create or replace function public.admin_cancel_vault_unlock(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_found boolean;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;
  delete from vault_unlock_events where id = p_event_id and applied_at is null;
  get diagnostics v_found = row_count;
  return v_found;
end;
$$;

revoke all on function public.admin_cancel_vault_unlock(uuid) from public, anon;
grant execute on function public.admin_cancel_vault_unlock(uuid) to authenticated;

-- ── Fire due events (service-only, run by the cron edge fn) ──────────────────
-- Pulls targeted pending deposits to READY, stamps the event, and returns
-- the newly-ready users (notify events only) so the edge fn can push.

create or replace function public.process_vault_unlock_events()
returns table (user_id uuid, notify boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  ev       record;
  aff      record;
  v_users  int;
  v_points int;
begin
  perform pg_advisory_xact_lock(hashtextextended('vault_unlock_events', 0));

  for ev in
    select * from vault_unlock_events
     where applied_at is null and unlock_at <= now()
     order by unlock_at
  loop
    v_users := 0;
    v_points := 0;

    for aff in
      with hit as (
        update vault_deposits vd
           set vests_at = now()
         where vd.released_at is null
           and vd.vests_at > now()
           and (ev.target = 'all' or vd.user_id = any (ev.user_ids))
        returning vd.user_id, vd.amount
      )
      select hit.user_id as uid, sum(hit.amount)::int as pts
        from hit group by hit.user_id
    loop
      v_users := v_users + 1;
      v_points := v_points + aff.pts;
      user_id := aff.uid;
      notify  := ev.notify;
      return next;
    end loop;

    -- Stamp what this event actually changed (a deposit pulled by an
    -- earlier event this tick can't be counted twice — the update above
    -- only touches vests_at > now()).
    update vault_unlock_events e
       set applied_at = now(), affected_users = v_users, affected_points = v_points
     where e.id = ev.id;
  end loop;
end;
$$;

revoke all on function public.process_vault_unlock_events() from public, anon, authenticated;
