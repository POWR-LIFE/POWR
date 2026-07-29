-- Until the July 2026 redeem-reward fix (fb7c59a), claiming a pool code flipped
-- redemption_codes.status straight to 'used' inside the same request that
-- assigned it. So 'used' recorded a member taking a code, not a brand accepting
-- one — which made partner reconciliation a no-op and left every one of those
-- rows asserting a real-world spend nobody ever confirmed. That column is
-- exactly what the partner portal reads to tell a brand which codes it has
-- already honoured, so the wrong rows have to go before it can be shown.
--
-- The two populations separate cleanly, and two independent signals agree on
-- the same partition:
--   * the flip happened within the redeem request — used_at lands at most
--     0.26s after assigned_at, while every genuine reconciliation is 50s+ later
--   * every sub-second row predates the fix; every later one postdates it
-- The 5s threshold below sits inside the empty ~50-second band between them.
--
-- 'reserved' is the state the fixed flow leaves a claimed code in: the member
-- holds it, the brand has not confirmed it. Restoring that also lets brands
-- reconcile these codes properly for the first time. Nothing is notified —
-- trg_code_used_webhook only fires on a transition *to* 'used'.

create table if not exists public.redemption_codes_legacy_used_backup (
  id           uuid primary key,
  code         text,
  reward_id    uuid,
  source       text,
  status       text,
  assigned_at  timestamptz,
  used_at      timestamptz,
  backed_up_at timestamptz not null default now()
);

comment on table public.redemption_codes_legacy_used_backup is
  'Pre-image of the redeem-time used-flips corrected by migration 20260729000001. Retained so the correction is reversible; no application reads it.';

-- Service-role only: nothing in the app has any business reading this.
alter table public.redemption_codes_legacy_used_backup enable row level security;

insert into public.redemption_codes_legacy_used_backup
  (id, code, reward_id, source, status, assigned_at, used_at)
select rc.id, rc.code, rc.reward_id, rc.source, rc.status, rc.assigned_at, rc.used_at
  from public.redemption_codes rc
 where rc.status = 'used'
   and rc.assigned_at is not null
   and rc.used_at is not null
   and rc.used_at <= rc.assigned_at + interval '5 seconds'
on conflict (id) do nothing;

update public.redemption_codes rc
   set status  = 'reserved',
       used_at = null
 where rc.status = 'used'
   and rc.assigned_at is not null
   and rc.used_at is not null
   and rc.used_at <= rc.assigned_at + interval '5 seconds';
