import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LEVELS, getLevelInfo } from '@/constants/levels';
import { useAuth } from '@/context/AuthContext';
import { usePoints } from '@/hooks/usePoints';

// Same test account that bypasses the one-session-per-day guard in
// GeofenceContext — gets a long-press replay of the celebration for QA.
const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

const storageKey = (userId: string) => `@powr/level_seen:${userId}`;

interface SeenMarker {
  level: number;
  totalEarned: number;
}

export interface PendingLevelUp {
  fromLevel: number;
  toLevel: number;
  /** Lifetime XP at the moment the previous level was last seen — lets the
   *  celebration charge the progress bar from the user's real position. */
  fromXp: number;
}

/**
 * Watches lifetime earned points and surfaces a one-shot level-up event.
 *
 * The last level the user has *seen celebrated* is persisted per account, so
 * the moment lands exactly once — on whichever device they open first — and
 * multi-level jumps collapse into a single celebration to the final level.
 * First run on a device seeds the marker silently (no celebration for
 * levels earned before the feature existed, and none on reinstall).
 */
export function useLevelUp() {
  const { user } = useAuth();
  const { totalEarned, loading } = usePoints();
  const [pending, setPending] = useState<PendingLevelUp | null>(null);

  useEffect(() => {
    // Never re-evaluate mid-celebration; ack() moves the marker when it ends.
    if (!user || loading || pending) return;
    let cancelled = false;

    (async () => {
      const key = storageKey(user.id);
      const currentLevel = getLevelInfo(totalEarned).current.level;
      const raw = await AsyncStorage.getItem(key);
      if (cancelled) return;

      if (!raw) {
        await AsyncStorage.setItem(key, JSON.stringify({ level: currentLevel, totalEarned }));
        return;
      }

      const seen: SeenMarker = JSON.parse(raw);
      if (currentLevel > seen.level) {
        setPending({ fromLevel: seen.level, toLevel: currentLevel, fromXp: seen.totalEarned });
      } else if (currentLevel < seen.level) {
        // Points were reversed (e.g. a rejected session) — quietly follow the
        // level down so the eventual re-cross celebrates again.
        await AsyncStorage.setItem(key, JSON.stringify({ level: currentLevel, totalEarned }));
      } else if (totalEarned !== seen.totalEarned) {
        // Same level, new XP: keep the stored position current so the charge
        // animation starts from where the user actually was.
        await AsyncStorage.setItem(key, JSON.stringify({ level: currentLevel, totalEarned }));
      }
    })();

    return () => { cancelled = true; };
  }, [user, loading, totalEarned, pending]);

  const ack = useCallback(() => {
    setPending(null);
    if (user) {
      const currentLevel = getLevelInfo(totalEarned).current.level;
      AsyncStorage.setItem(storageKey(user.id), JSON.stringify({ level: currentLevel, totalEarned }));
    }
  }, [user, totalEarned]);

  /**
   * Dev-account-only: replay the celebration. Successive presses cycle the
   * three graduation grades — your real level (standard for most levels),
   * then a tier cross (5→6), then the apex (19→20) — so every treatment can
   * be felt on-device without touching real points.
   */
  const previewCycle = useRef(0);
  const preview = useCallback(() => {
    if (!user || !DEV_TEST_EMAILS.has(user.email ?? '')) return;
    const { current } = getLevelInfo(totalEarned);
    const demos: { fromLevel: number; toLevel: number }[] = [
      { fromLevel: Math.max(1, current.level - 1), toLevel: Math.max(current.level, 2) },
      { fromLevel: 5, toLevel: 6 },
      { fromLevel: 19, toLevel: 20 },
    ];
    const { fromLevel, toLevel } = demos[previewCycle.current % demos.length];
    previewCycle.current += 1;
    const fromDef = LEVELS.find(l => l.level === fromLevel) ?? LEVELS[0];
    const toDef = LEVELS.find(l => l.level === toLevel) ?? LEVELS[LEVELS.length - 1];
    setPending({
      fromLevel,
      toLevel,
      // Start the charge bar ~70% of the way through the previous level.
      fromXp: fromDef.xpMin + Math.round((toDef.xpMin - fromDef.xpMin) * 0.7),
    });
  }, [user, totalEarned]);

  return { pending, ack, preview };
}
