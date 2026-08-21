-- Let the native health path RECORD the workout a geofence check-in outranks.
--
-- Product call (Jamie, 2026-08-21): a wearable user who runs inside a gym visit
-- is rewarded ONCE, for the check-in — but the run still happened and must stay
-- visible. "Reward the gym, record the run." The Terra path already records the
-- loser in suppressed_workouts (terra-webhook at arrival, claim-points for the
-- reverse order). The native HealthKit / Health Connect path could not: the
-- client-side guard in logManualSession skips the insert, and this table
-- deliberately had no client INSERT policy — so an Apple Watch run vanished
-- while the identical Whoop run left an auditable record.
--
-- This opens the narrowest possible door:
--   * own rows only;
--   * reason pinned to the native-guard value, so a client can never forge a
--     server-written suppression (terra-webhook and claim-points keep their own
--     reasons and write with the service role, which bypasses RLS);
--   * only while an own geofence check-in actually overlaps the claimed window —
--     outside a check-in there is nothing to suppress and the insert is refused;
--   * INSERT only — ON CONFLICT DO NOTHING keeps the sync loop idempotent
--     without ever needing an UPDATE policy, so a recorded row is immutable
--     to its author.
--
-- Risk is cosmetic by construction: nothing pays from this table, no challenge
-- evaluator reads it, and surfaced rows render as unrewarded ("—"), so a forged
-- row could only ever misstate its own author's history inside a real visit.

drop policy if exists "native path records own suppression" on public.suppressed_workouts;
create policy "native path records own suppression" on public.suppressed_workouts
    for insert to authenticated
    with check (
        auth.uid() = user_id
        and reason = 'overlaps_geofence_checkin_native'
        and type not in ('walking', 'sleep')
        and exists (
            select 1 from public.activity_sessions s
            where s.user_id = auth.uid()
              and s.verification = 'geofence'
              and s.started_at < suppressed_workouts.ended_at
              and coalesce(
                    s.ended_at,
                    s.started_at + make_interval(secs => coalesce(s.duration_sec, 0))
                  ) > suppressed_workouts.started_at
        )
    );

comment on table public.suppressed_workouts is
    'Wearable/native workouts dropped because they overlapped a higher-trust geofence check-in. '
    'Never pays and no challenge evaluator reads it, but since 2026-08-21 the client surfaces these '
    'rows in history and Progress stats as unrewarded sessions ("reward the gym, record the run"). '
    'Server rows come from terra-webhook/claim-points under the service role; the client may only '
    'insert its own native-path suppressions while an overlapping own check-in exists.';
