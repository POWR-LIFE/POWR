-- =============================================================
-- PARTNER DEVELOPER API
-- Machine credentials + outbound webhooks + just-in-time code minting so
-- reward brands can automate code supply and usage reconciliation instead
-- of CSV uploads. Brands are identified by rewards.brand_name, mirroring
-- reward_brand_users — the partners table (gym locations) is never touched.
-- (The legacy partner_api_keys table references partners and stays unused.)
--
-- Lifecycle this enables:
--   partner pushes codes  → POST /v1/codes           (or portal, unchanged)
--   member redeems        → code goes 'reserved' + code.assigned webhook
--   pool runs low         → pool.low webhook
--   partner confirms use  → POST /v1/reconcile → 'used' + code.used webhook
--   or, with JIT minting  → POWR asks the partner's endpoint for a fresh
--                           code at redemption time; no pool, no reconcile.
-- =============================================================

-- JIT-minted codes carry their own source tag. Batch pushes via the API
-- reuse 'PARTNER_UPLOAD' (same semantics as a portal CSV upload).
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.redemption_codes'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source = any%';
  if v_name is not null then
    execute format('alter table public.redemption_codes drop constraint %I', v_name);
  end if;
end$$;

alter table public.redemption_codes
  add constraint redemption_codes_source_check
    check (source in ('PARTNER_UPLOAD', 'POWR_GENERATED', 'PARTNER_API'));

-- =============================================================
-- API keys — hashed at rest; the plaintext key is shown once at creation.
-- =============================================================
create table if not exists public.reward_brand_api_keys (
  id           uuid primary key default gen_random_uuid(),
  brand_name   text not null,
  label        text not null default 'API key',
  key_prefix   text not null,          -- displayable stub, e.g. powr_sk_live_1a2b…
  key_hash     text not null unique,   -- sha256 hex of the full key
  scopes       text[] not null default '{read,write}',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists idx_brand_api_keys_brand
  on public.reward_brand_api_keys (lower(brand_name));

alter table public.reward_brand_api_keys enable row level security;

create policy "Brand users read own api keys"
  on public.reward_brand_api_keys for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = (select auth.uid())
        and lower(u.brand_name) = lower(reward_brand_api_keys.brand_name)
    )
  );

create policy "Admins read all api keys"
  on public.reward_brand_api_keys for select
  to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- Writes are service-role only (via the manage-partner-api edge function).

-- Fixed-window rate limiting (per key, per minute). Service-role only.
create table if not exists public.reward_brand_api_rate (
  key_id       uuid not null references public.reward_brand_api_keys(id) on delete cascade,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key_id, window_start)
);

alter table public.reward_brand_api_rate enable row level security;

-- Atomically counts a request against the key's current 1-minute window.
-- Returns true while the key is under p_limit.
create or replace function public.bump_api_rate(p_key_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into public.reward_brand_api_rate as r (key_id, window_start, count)
  values (p_key_id, v_window, 1)
  on conflict (key_id, window_start)
  do update set count = r.count + 1
  returning r.count into v_count;

  -- Opportunistic prune so the table stays tiny.
  delete from public.reward_brand_api_rate
   where key_id = p_key_id and window_start < now() - interval '10 minutes';

  return v_count <= p_limit;
end;
$$;

revoke all on function public.bump_api_rate(uuid, integer) from public, anon, authenticated;

-- Idempotency replay cache for API mutations. Service-role only.
create table if not exists public.reward_brand_api_idempotency (
  key_id          uuid not null references public.reward_brand_api_keys(id) on delete cascade,
  idem_key        text not null,
  response_status integer not null,
  response_body   jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (key_id, idem_key)
);

alter table public.reward_brand_api_idempotency enable row level security;

-- =============================================================
-- Outbound webhooks — endpoint registry + delivery outbox
-- =============================================================
create table if not exists public.reward_brand_webhook_endpoints (
  id                   uuid primary key default gen_random_uuid(),
  brand_name           text not null,
  url                  text not null,
  secret               text not null,  -- HMAC signing secret (whsec_…), shown in portal
  events               text[] not null default '{code.assigned,code.used,pool.low}',
  active               boolean not null default true,
  consecutive_failures integer not null default 0,
  disabled_at          timestamptz,
  disabled_reason      text,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists idx_brand_webhook_endpoints_brand
  on public.reward_brand_webhook_endpoints (lower(brand_name));

alter table public.reward_brand_webhook_endpoints enable row level security;

create policy "Brand users read own webhook endpoints"
  on public.reward_brand_webhook_endpoints for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = (select auth.uid())
        and lower(u.brand_name) = lower(reward_brand_webhook_endpoints.brand_name)
    )
  );

create policy "Admins read all webhook endpoints"
  on public.reward_brand_webhook_endpoints for select
  to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

create table if not exists public.reward_brand_webhook_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  endpoint_id          uuid not null references public.reward_brand_webhook_endpoints(id) on delete cascade,
  brand_name           text not null,
  event_type           text not null,
  payload              jsonb not null,
  status               text not null default 'pending'
                         check (status in ('pending', 'delivered', 'failed', 'skipped')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  last_attempt_at      timestamptz,
  last_response_status integer,
  last_error           text,
  created_at           timestamptz not null default now(),
  delivered_at         timestamptz
);

create index if not exists idx_brand_webhook_deliveries_due
  on public.reward_brand_webhook_deliveries (next_attempt_at)
  where status = 'pending';

create index if not exists idx_brand_webhook_deliveries_brand
  on public.reward_brand_webhook_deliveries (lower(brand_name), created_at desc);

-- pool.low dedupe looks up recent events per reward.
create index if not exists idx_brand_webhook_deliveries_event
  on public.reward_brand_webhook_deliveries (event_type, created_at desc);

alter table public.reward_brand_webhook_deliveries enable row level security;

create policy "Brand users read own webhook deliveries"
  on public.reward_brand_webhook_deliveries for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = (select auth.uid())
        and lower(u.brand_name) = lower(reward_brand_webhook_deliveries.brand_name)
    )
  );

create policy "Admins read all webhook deliveries"
  on public.reward_brand_webhook_deliveries for select
  to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- =============================================================
-- Per-brand integration settings — JIT minting + pool-low threshold
-- =============================================================
create table if not exists public.reward_brand_integrations (
  brand_name                text primary key,
  mint_url                  text,
  mint_secret               text,
  mint_enabled              boolean not null default false,
  mint_consecutive_failures integer not null default 0,
  mint_disabled_until       timestamptz,
  pool_low_threshold        integer not null default 10 check (pool_low_threshold >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- brand_name matching is case-insensitive everywhere else; make sure two
-- casings can't create two settings rows.
create unique index if not exists idx_brand_integrations_lower
  on public.reward_brand_integrations (lower(brand_name));

alter table public.reward_brand_integrations enable row level security;

create policy "Brand users read own integration settings"
  on public.reward_brand_integrations for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = (select auth.uid())
        and lower(u.brand_name) = lower(reward_brand_integrations.brand_name)
    )
  );

create policy "Admins read all integration settings"
  on public.reward_brand_integrations for select
  to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- =============================================================
-- Enqueue helper — one delivery row per active endpoint subscribed to the
-- event. No-ops (returns 0) for brands with no matching endpoints, so
-- callers can enqueue unconditionally.
-- =============================================================
create or replace function public.enqueue_brand_webhook(
  p_brand_name text,
  p_event_type text,
  p_payload    jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_count integer;
begin
  if p_brand_name is null or trim(p_brand_name) = '' then
    return 0;
  end if;

  insert into public.reward_brand_webhook_deliveries (endpoint_id, brand_name, event_type, payload)
  select e.id,
         e.brand_name,
         p_event_type,
         jsonb_build_object(
           'id', v_event_id,
           'type', p_event_type,
           'created_at', now(),
           'data', coalesce(p_payload, '{}'::jsonb)
         )
    from public.reward_brand_webhook_endpoints e
   where lower(e.brand_name) = lower(p_brand_name)
     and e.active
     and p_event_type = any(e.events);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_brand_webhook(text, text, jsonb) from public, anon, authenticated;

-- =============================================================
-- code.used → webhook, at the table chokepoint so every path that confirms
-- usage (portal CSV reconcile, API reconcile, admin) notifies the brand.
-- =============================================================
create or replace function public.tg_code_used_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand text;
  v_title text;
begin
  select r.brand_name, r.title into v_brand, v_title
    from public.rewards r where r.id = new.reward_id;
  if v_brand is null then
    return new;
  end if;

  perform public.enqueue_brand_webhook(v_brand, 'code.used', jsonb_build_object(
    'brand_name', v_brand,
    'reward_id', new.reward_id,
    'reward_title', v_title,
    'code_id', new.id,
    'code', new.code,
    'used_at', new.used_at
  ));
  return new;
end;
$$;

drop trigger if exists trg_code_used_webhook on public.redemption_codes;
create trigger trg_code_used_webhook
  after update of status on public.redemption_codes
  for each row
  when (new.status = 'used' and old.status is distinct from new.status)
  execute function public.tg_code_used_webhook();

-- =============================================================
-- Reconciliation, brand-parameterised — the API edge function runs as
-- service role (key auth, no auth.uid()), so it asserts the brand itself.
-- Same one-way semantics as reconcile_partner_redemption_codes: only
-- 'reserved' codes can become 'used'.
-- =============================================================
create or replace function public.reconcile_brand_redemption_codes(
  p_brand_name text,
  p_reward_id  uuid,
  p_codes      text[],
  p_used_at    timestamptz default now()
)
returns table (
  submitted_count integer,
  matched_count integer,
  marked_used_count integer,
  already_used_count integer,
  unavailable_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes text[];
begin
  if not exists (
    select 1 from public.rewards r
     where r.id = p_reward_id
       and lower(r.brand_name) = lower(p_brand_name)
  ) then
    raise exception 'Reward does not belong to this brand';
  end if;

  select coalesce(array_agg(distinct upper(trim(code))), '{}')
    into v_codes
    from unnest(coalesce(p_codes, '{}')) as code
   where trim(code) <> '';

  if cardinality(v_codes) > 5000 then
    raise exception 'A reconciliation batch can contain at most 5,000 codes';
  end if;

  return query
  with matched as (
    select rc.id, rc.status
      from public.redemption_codes rc
     where rc.reward_id = p_reward_id
       and rc.code = any(v_codes)
     for update
  ), updated as (
    update public.redemption_codes rc
       set status = 'used',
           used_at = least(coalesce(p_used_at, now()), now())
      from matched m
     where rc.id = m.id
       and m.status = 'reserved'
    returning rc.id
  )
  select
    cardinality(v_codes)::integer,
    (select count(*)::integer from matched),
    (select count(*)::integer from updated),
    (select count(*)::integer from matched where status = 'used'),
    (select count(*)::integer from matched where status not in ('reserved', 'used'));
end;
$$;

revoke all on function public.reconcile_brand_redemption_codes(text, uuid, text[], timestamptz) from public, anon, authenticated;

-- =============================================================
-- Dispatcher claim — SKIP LOCKED so overlapping cron runs never double-send.
-- Attempts are counted at claim time; the dispatcher then settles each row
-- to delivered / pending(retry) / failed.
-- =============================================================
create or replace function public.claim_due_webhook_deliveries(p_limit integer default 50)
returns setof public.reward_brand_webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.reward_brand_webhook_deliveries d
     set attempts = d.attempts + 1,
         last_attempt_at = now()
   where d.id in (
     select id from public.reward_brand_webhook_deliveries
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked
   )
  returning d.*;
end;
$$;

revoke all on function public.claim_due_webhook_deliveries(integer) from public, anon, authenticated;

-- =============================================================
-- Dispatcher heartbeat — every minute, deliver due webhooks. Reuses the
-- shared x-resolve-token cron secret from Vault (never hardcoded here),
-- mirroring dispatch-scheduled-broadcasts.
-- =============================================================
create extension if not exists pg_cron;

do $job$
begin
  perform cron.unschedule('dispatch-brand-webhooks');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'dispatch-brand-webhooks',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/partner-webhook-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
