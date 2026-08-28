-- ============================================================================
-- Admin affiliate stats + referred list
-- ============================================================================
-- The Affiliates tab counted signups/conversions from a direct client read of
-- public.referrals. RLS on that table only exposes rows where the caller is the
-- referrer or the referred (or the affiliate themselves), so an admin saw the
-- referrals they were personally in and nothing else — on 2026-08-28 the page
-- showed Jamie 1/1 (real 5/5) and Elliot 0/0 (real 1/1) while the conversion
-- push, which runs as definer, was correct. Two admin-gated definer RPCs
-- replace that read; the second also answers "who converted?" per affiliate.

create or replace function public.admin_creator_referral_stats()
returns table (creator_id uuid, signups bigint, converted bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select r.creator_id, count(*)::bigint, count(r.converted_at)::bigint
      from public.referrals r
     where r.creator_id is not null
     group by r.creator_id;
end;
$$;
revoke all on function public.admin_creator_referral_stats() from public, anon;
grant execute on function public.admin_creator_referral_stats() to authenticated;

create or replace function public.admin_creator_referrals(p_creator_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'referral_id',   r.id,
           'user_id',       r.referred_id,
           'display_name',  p.display_name,
           'username',      p.username,
           'email',         u.email,
           'source',        r.source,
           'signed_up_at',  r.created_at,
           'converted_at',  r.converted_at,
           'points_paid',   e.points_amount,
           'converting_session', case when s.id is null then null else jsonb_build_object(
             'id', s.id, 'type', s.type, 'verification', s.verification,
             'duration_sec', s.duration_sec, 'steps', s.steps, 'started_at', s.started_at) end
         ) order by r.created_at desc), '[]'::jsonb)
    into v_out
    from public.referrals r
    left join public.profiles p on p.id = r.referred_id
    left join auth.users u on u.id = r.referred_id
    left join public.activity_sessions s on s.id = r.converting_session_id
    left join public.creator_earnings e on e.referral_id = r.id and e.kind = 'conversion'
   where r.creator_id = p_creator_id;

  return v_out;
end;
$$;
revoke all on function public.admin_creator_referrals(uuid) from public, anon;
grant execute on function public.admin_creator_referrals(uuid) to authenticated;
