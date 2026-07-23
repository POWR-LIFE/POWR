import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RescueRequirementType, StreakRescueOffer } from '@/hooks/useStreakRescue';

const GOLD = '#E8D200';
const ORANGE = '#f97316';

// One-shot per (rescue, state): the offer announces itself once, the save
// celebrates itself once. After dismissal the quiet layer on the StreakCard
// (highlighted missed day + one-line progress) carries the state — a modal
// that reappeared on every open would be the opposite of "less invasive".
const SEEN_PREFIX = '@powr/rescue_seen/';

const UNIT_LABEL: Record<RescueRequirementType, [string, string]> = {
  sessions:     ['session', 'sessions'],
  gym_sessions: ['gym session', 'gym sessions'],
  active_days:  ['active day', 'active days'],
  steps:        ['step', 'steps'],
};

function requirementPhrase(type: RescueRequirementType, n: number): string {
  const [one, many] = UNIT_LABEL[type] ?? UNIT_LABEL.sessions;
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function hoursLeft(expiresAt: string): number {
  return Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 3600_000));
}

export function StreakRescueModal({ rescue }: { rescue: StreakRescueOffer | null }) {
  const [visible, setVisible] = useState(false);

  const seenKey = rescue ? `${SEEN_PREFIX}${rescue.id}/${rescue.state}` : null;

  useEffect(() => {
    let cancelled = false;
    if (!seenKey) { setVisible(false); return; }
    AsyncStorage.getItem(seenKey)
      .then((seen) => { if (!cancelled && !seen) setVisible(true); })
      .catch(() => { /* storage unreadable — stay quiet rather than nag */ });
    return () => { cancelled = true; };
  }, [seenKey]);

  const dismiss = () => {
    setVisible(false);
    if (seenKey) AsyncStorage.setItem(seenKey, '1').catch(() => {});
  };

  if (!rescue) return null;
  const saved = rescue.state === 'saved';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, saved && styles.sheetSaved]}>
          <View style={[styles.iconRing, saved && styles.iconRingSaved]}>
            <Ionicons name={saved ? 'flame' : 'bandage-outline'} size={30} color={saved ? GOLD : ORANGE} />
          </View>

          <Text style={styles.kicker}>{saved ? 'RESCUE COMPLETE' : 'STREAK RESCUE'}</Text>
          <Text style={styles.title}>
            {saved ? 'Streak saved' : (rescue.label || 'Save your streak')}
          </Text>

          <Text style={styles.body}>
            {saved
              ? `You did the work — your ${rescue.lostStreak}-day streak is back and counting. Protect it tonight.`
              : `Your ${rescue.lostStreak}-day streak isn't gone yet. ${requirementPhrase(rescue.requirementType, rescue.sessionsRequired)} in the next ${hoursLeft(rescue.expiresAt)}h brings the whole thing back.`}
          </Text>

          {!saved && (
            <Text style={styles.hint}>
              Every verified workout counts automatically — just train.
            </Text>
          )}

          <Pressable
            onPress={dismiss}
            style={({ pressed }) => [styles.cta, saved && styles.ctaSaved, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.ctaText, saved && styles.ctaTextSaved]}>
              {saved ? 'KEEP IT ROLLING' : "LET'S GO"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#111111',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.45)',
    padding: 28,
    alignItems: 'center',
  },
  sheetSaved: {
    borderColor: GOLD,
    backgroundColor: '#161403',
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(249,115,22,0.5)',
    backgroundColor: 'rgba(249,115,22,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconRingSaved: {
    borderColor: 'rgba(232,210,0,0.6)',
    backgroundColor: 'rgba(232,210,0,0.12)',
  },
  kicker: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 4,
  },
  cta: {
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  ctaSaved: {
    backgroundColor: GOLD,
  },
  ctaText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  ctaTextSaved: {
    color: '#111111',
  },
});
