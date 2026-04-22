-- =============================================================
-- Update claim_pool_code to accept p_expires_at so the code's
-- expiry resets to now() + code_expiry_days at claim time,
-- not at upload time. This ensures the user always gets a fresh
-- expiry window regardless of how old the batch is.
-- =============================================================
create or replace function public.claim_pool_code(
  p_reward_id  uuid,
  p_user_id    uuid,
  p_expires_at timestamptz default null
) returns table (id uuid, code text)
language plpgsql
security definer
as $$
declare
  v_id   uuid;
  v_code text;
begin
  select rc.id, rc.code into v_id, v_code
    from public.redemption_codes rc
   where rc.reward_id = p_reward_id
     and rc.status = 'available'
     and rc.expires_at > now()
   order by rc.created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.redemption_codes
     set status           = 'reserved',
         assigned_user_id = p_user_id,
         assigned_at      = now(),
         expires_at       = coalesce(p_expires_at, expires_at)
   where redemption_codes.id = v_id;

  return query select v_id, v_code;
end;
$$;

revoke all on function public.claim_pool_code(uuid, uuid, timestamptz) from public, anon, authenticated;
-- Service role only.
