-- =============================================================
-- Late invite-code entry — a 14-day grace window, enforced here
-- =============================================================
-- An invite code can only ever be applied by the person being
-- referred, and `referrals` has UNIQUE (referred_id), so every
-- account can be referred at most once, ever.
--
-- Until now the ONLY call site was onboarding-achievement, so a
-- friend who installed from the store, never saw the code and
-- finished onboarding without it had lost it for good. That is a
-- real miss and it deserves a second chance.
--
-- What it must NOT become is a points-swap ritual among people who
-- have been here for months: the live-event entry gate counts raw
-- `referrals` rows by referrer (entry_gate_counting = 'signups'),
-- so five existing mates typing your code would unlock an event
-- exactly like five real recruits.
--
-- The grace window is what keeps both true. Someone inside their
-- first 14 days IS a new signup — they just entered it late — so
-- the gate keeps meaning what it says, and no schema change or
-- gate filter is needed. The window is enforced HERE rather than
-- in the UI, so hiding the row is presentation, not security.

-- How long after signup a code can still be applied.
create or replace function public.referral_entry_window()
returns interval
language sql
immutable
as $$ select interval '14 days' $$;

comment on function public.referral_entry_window() is
  'How long after signup an invite code can still be applied. One definition, read by process_referral and referral_entry_state.';

-- =============================================================
-- process_referral — unchanged except the window check
-- =============================================================
create or replace function public.process_referral(p_referral_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_referred_id uuid := auth.uid();
  v_created_at  timestamptz;
begin
  if v_referred_id is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  p_referral_code := upper(trim(p_referral_code));

  select id into v_referrer_id
    from public.profiles
   where referral_code = p_referral_code;

  if v_referrer_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  if v_referrer_id = v_referred_id then
    return jsonb_build_object('success', false, 'error', 'self_referral');
  end if;

  -- The grace window. Checked AFTER the code is resolved so a user
  -- who is out of time still learns their code was real.
  select created_at into v_created_at
    from public.profiles
   where id = v_referred_id;

  if v_created_at is not null
     and v_created_at < now() - public.referral_entry_window() then
    return jsonb_build_object('success', false, 'error', 'window_closed');
  end if;

  begin
    insert into public.referrals (referrer_id, referred_id)
      values (v_referrer_id, v_referred_id);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_referred');
  end;

  return jsonb_build_object(
    'success',     true,
    'referrer_id', v_referrer_id,
    'reward',      0,
    'status',      'pending_first_workout'
  );
end;
$$;

-- =============================================================
-- referral_entry_state — what the Settings row should render
-- =============================================================
-- Definer because it reads the REFERRER's profile name, which the
-- caller has no business selecting wholesale. Returns only the one
-- name they are already entitled to know: who invited them.
create or replace function public.referral_entry_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_created_at  timestamptz;
  v_referrer_id uuid;
  v_name        text;
  v_deadline    timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('referred', false, 'eligible', false);
  end if;

  -- Existence and NAME are separate questions: a referrer who never
  -- finished the profile step has neither display_name nor username,
  -- and keying "am I referred?" off the name would report false for a
  -- row that plainly exists — the UI would then offer an entry that
  -- can only ever come back 'already_referred'.
  select r.referrer_id,
         coalesce(nullif(trim(rp.display_name), ''), '@' || rp.username, 'a friend')
    into v_referrer_id, v_name
    from public.referrals r
    join public.profiles rp on rp.id = r.referrer_id
   where r.referred_id = v_uid;

  if v_referrer_id is not null then
    return jsonb_build_object('referred', true, 'eligible', false, 'referrer_name', v_name);
  end if;

  select created_at into v_created_at from public.profiles where id = v_uid;
  v_deadline := coalesce(v_created_at, now()) + public.referral_entry_window();

  return jsonb_build_object(
    'referred',  false,
    'eligible',  v_deadline > now(),
    -- Ceiling, so the last partial day still reads as "1 day left".
    'days_left', greatest(0, ceil(extract(epoch from (v_deadline - now())) / 86400)::int)
  );
end;
$$;

comment on function public.referral_entry_state() is
  'Whether the caller can still apply an invite code (and who referred them, if anyone). Drives the Settings row; process_referral is the thing that actually enforces the window.';

revoke all on function public.referral_entry_window()  from public, anon;
revoke all on function public.referral_entry_state()   from public, anon;
grant execute on function public.referral_entry_window() to authenticated;
grant execute on function public.referral_entry_state()  to authenticated;
