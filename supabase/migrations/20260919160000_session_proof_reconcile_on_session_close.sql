-- Session Review: re-run the proof audit when the SESSION takes its final shape
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260914150000 re-runs the audit from a trigger on gym_visits. close_gym_visit
-- writes in this order: the visit row (that trigger fires), THEN the `exit`
-- event, THEN the claimed activity_session's ended_at / duration_sec. So at the
-- moment the visit trigger runs, gym_visit_end_witnessed_at cannot see the
-- witness yet and the session still carries its pre-close duration — and no
-- later gym_visits write re-runs it. A flagged session closed by a witnessed
-- exit could stay queued. The session update is the close path's LAST write, so
-- reconcile there as well.
--
-- SECURITY DEFINER, unlike the visit trigger's function: the phone updates its
-- own activity_sessions row directly (the grows-only extend), and
-- reconcile_session_proof_flag inserts a `proof_audit` row into
-- gym_visit_events, which has no INSERT policy for users. As the invoker that
-- insert fails and takes the phone's whole UPDATE down with it — on exactly the
-- rows whose flag was about to clear.
--
-- GROWS-ONLY: fires when the duration did not shrink. A witnessed close extends
-- the session, which is the case this exists for. A shrink is excluded so a
-- client cannot trim a flagged session down to its proven floor and clear its
-- own flag while keeping the points the longer claim was paid.

create or replace function public.activity_session_reconcile_proof_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform reconcile_session_proof_flag(new.id);
  return null;
end;
$$;

revoke all on function public.activity_session_reconcile_proof_flag() from public, anon, authenticated;

drop trigger if exists activity_sessions_reconcile_proof_flag on public.activity_sessions;
create trigger activity_sessions_reconcile_proof_flag
  after update of ended_at, duration_sec on public.activity_sessions
  for each row
  when (
    coalesce(new.flagged, false)
    and coalesce(new.flag_reason, '') like '%unproven_duration%'
    and coalesce(new.duration_sec, 0) >= coalesce(old.duration_sec, 0)
  )
  execute function public.activity_session_reconcile_proof_flag();

-- 20260914150000 revoked the queue RPC from anon and authenticated but not from
-- PUBLIC, which is where Postgres puts the default EXECUTE. is_admin() inside
-- already returns nothing to a non-admin; this just closes the endpoint to anon.
revoke all on function public.admin_session_review_queue(boolean, integer) from public, anon;
grant execute on function public.admin_session_review_queue(boolean, integer) to authenticated;
