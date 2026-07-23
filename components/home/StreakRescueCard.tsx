import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RescueRequirementType, StreakRescueOffer } from '@/hooks/useStreakRescue';

const GOLD = '#E8D200';

const UNIT_LABEL: Record<RescueRequirementType, [string, string]> = {
  sessions:     ['session', 'sessions'],
  gym_sessions: ['gym session', 'gym sessions'],
  active_days:  ['active day', 'active days'],
  steps:        ['step', 'steps'],
};

function unitFor(type: RescueRequirementType, n: number): string {
  const [one, many] = UNIT_LABEL[type] ?? UNIT_LABEL.sessions;
  return n === 1 ? one : many;
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'ending now';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h}h left`;
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `${m}m left`;
}

/**
 * Live streak-rescue offer, shown above the streak card while the window is
 * open. Mirrors the StreakCard dark-card language: no CTA button — every
 * qualifying session (gym check-in, wearable workout, daily steps) advances
 * it automatically, so the card just states the deal and the score.
 */
export function StreakRescueCard({ rescue }: { rescue: StreakRescueOffer }) {
  const [remaining, setRemaining] = useState(() => formatRemaining(rescue.expiresAt));

  useEffect(() => {
    const t = setInterval(() => setRemaining(formatRemaining(rescue.expiresAt)), 60_000);
    return () => clearInterval(t);
  }, [rescue.expiresAt]);

  const done = Math.min(rescue.sessionsDone, rescue.sessionsRequired);
  const remainingCount = rescue.sessionsRequired - done;
  const pct = rescue.sessionsRequired > 0 ? done / rescue.sessionsRequired : 0;

  // Completed within the last 24h: hold a celebratory state instead of just
  // vanishing — the push is the announcement, this is the in-app applause
  // (and the only applause for users with notifications off).
  if (rescue.state === 'saved') {
    return (
      <View style={[styles.card, styles.cardSaved]}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="flame" size={16} color={GOLD} />
            <Text style={styles.title}>STREAK SAVED</Text>
          </View>
          <Text style={styles.remaining}>RESCUE COMPLETE</Text>
        </View>
        <Text style={styles.body}>
          You did the work — your {rescue.lostStreak}-day streak is back and counting. Protect it tonight.
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '100%' }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="flame-outline" size={16} color={GOLD} />
          <Text style={styles.title}>{(rescue.label || 'SAVE YOUR STREAK').toUpperCase()}</Text>
        </View>
        <Text style={styles.remaining}>{remaining.toUpperCase()}</Text>
      </View>

      <Text style={styles.body}>
        Your {rescue.lostStreak}-day streak isn&apos;t gone yet.{' '}
        {remainingCount > 0
          ? `${remainingCount.toLocaleString()} more ${unitFor(rescue.requirementType, remainingCount)} brings the whole thing back.`
          : 'Rescue complete — your streak is restored.'}
      </Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.progressLabel}>
        {done.toLocaleString()} / {rescue.sessionsRequired.toLocaleString()}{' '}
        {unitFor(rescue.requirementType, rescue.sessionsRequired).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.35)',
  },
  cardSaved: {
    borderColor: GOLD,
    backgroundColor: '#161403',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  remaining: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  body: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  progressLabel: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
