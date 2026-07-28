import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import type { SharedChallenge } from '@/lib/social/types';

// Same test account that gets the level-up replay hatch in useLevelUp — a
// settled challenge takes up to 72h to arrive naturally, so QA needs a way to
// see the moment without waiting out a real clock.
const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

const seenKey = (challengeId: string) => `@powr/challenge_settled_seen/${challengeId}`;
const seededKey = (userId: string) => `@powr/challenge_settled_seeded:${userId}`;

/**
 * Surfaces a one-shot "the challenge is over and your bonus is banked" event.
 *
 * The distinction that matters: `useSharedChallenges` already fires a
 * celebration when YOU finish YOUR part (`newlyCompletedId`), which for a
 * parallel challenge happens up to 72h before the group bonus exists. This
 * hook watches the other end — `settled_at` appearing, stamped by the resolve
 * cron or the pooled evaluator — which is when the points were actually
 * awarded and the "we did this together" story is finally true.
 *
 * Derived from list data rather than from the edge function's one-time
 * `newly_completed` flag, deliberately: four components mount
 * useSharedChallenges and all four run the completion sweep, so whichever one
 * calls the server first consumes that flag and the rest get `false`. A
 * comparison against persisted state has no such race.
 *
 * The marker is written on ACK, never on show (same house rule as useLevelUp
 * and StreakRescueModal) — if the app dies mid-celebration it replays next
 * open rather than being silently swallowed.
 */
export function useChallengeSettled(all: SharedChallenge[], loading = false) {
  const { user } = useAuth();
  const [pending, setPending] = useState<SharedChallenge | null>(null);
  const previewing = useRef(false);
  // ack() clears `pending` synchronously but persists the marker asynchronously,
  // and clearing re-runs the effect immediately. Belt-and-braces against that
  // re-read landing before the write: the session also remembers what it acked.
  const ackedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Wait for the first load to settle before deciding anything: seeding off a
    // not-yet-populated list would mark the account initialised while `all` is
    // still empty, and then the first challenge to arrive would look new.
    // Never re-evaluate mid-celebration; ack() moves the marker when it ends.
    // Also leave a dev preview alone — it has no real challenge to mark seen.
    if (!user || loading || pending || previewing.current) return;
    let cancelled = false;

    (async () => {
      // Settled, and the user actually did their part. Someone who fell short
      // gets no congratulations — that's a different (unbuilt) message.
      const candidates = all.filter((c) => {
        if (c.status !== 'completed' || !c.settledAt) return false;
        if (ackedRef.current.has(c.id)) return false;
        return c.participants.find((p) => p.isSelf)?.completed === true;
      });

      // First run for this account seeds every already-settled challenge as
      // seen, silently. Without it, shipping this lands a surprise celebration
      // for anything the 3-day list window still returns — a challenge that
      // finished two days ago, announced as if it just happened.
      //
      // This runs BEFORE the empty-candidates bail on purpose. An account whose
      // first run has nothing settled still needs the flag written, or it stays
      // "un-seeded" until its first real settlement — which would then be
      // swallowed as if it predated the feature.
      const seeded = await AsyncStorage.getItem(seededKey(user.id));
      if (cancelled) return;
      if (!seeded) {
        await AsyncStorage.multiSet([
          ...candidates.map((c) => [seenKey(c.id), '1'] as [string, string]),
          [seededKey(user.id), '1'],
        ]);
        return;
      }
      if (candidates.length === 0) return;

      // Oldest first, so a rare double settlement celebrates in the order it
      // happened; the second surfaces once the first is acked.
      const ordered = [...candidates].sort(
        (a, b) => Date.parse(a.settledAt!) - Date.parse(b.settledAt!),
      );
      for (const c of ordered) {
        const seen = await AsyncStorage.getItem(seenKey(c.id));
        if (cancelled) return;
        if (!seen) { setPending(c); return; }
      }
    })().catch(() => { /* storage unreadable — stay quiet rather than nag */ });

    return () => { cancelled = true; };
  }, [user, loading, all, pending]);

  const ack = useCallback(() => {
    const done = previewing.current ? null : pending;
    previewing.current = false;
    setPending(null);
    if (done) {
      ackedRef.current.add(done.id);
      AsyncStorage.setItem(seenKey(done.id), '1').catch(() => {});
    }
  }, [pending]);

  /**
   * Dev-account-only: replay the settled celebration against a real challenge
   * without consuming its seen-marker. Prefers one that's actually settled,
   * falling back to whatever's on screen so the treatment can be felt at any
   * point in a challenge's life.
   */
  const preview = useCallback(() => {
    if (!user || !DEV_TEST_EMAILS.has(user.email ?? '')) return;
    const target = all.find((c) => c.status === 'completed') ?? all[0];
    if (!target) return;
    previewing.current = true;
    setPending(target);
  }, [user, all]);

  return { pending, ack, preview };
}
