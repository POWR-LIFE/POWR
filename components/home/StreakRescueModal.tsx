import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RescueRequirementType, StreakRescueOffer } from '@/hooks/useStreakRescue';

const GOLD = '#E8D200';
const ORANGE = '#f97316';

// One-shot per (rescue, state, banked progress): the offer announces itself
// once, each banked unit on a countable challenge announces itself once
// ("just 1 left"), the save celebrates itself once. Steps challenges skip the
// progress re-announce — step counts advance continuously, so keying on them
// would re-pop the modal on every open. After dismissal the quiet layer on
// the StreakCard (highlighted missed day + one-line progress) carries the
// state — a modal that reappeared on every open would be the opposite of
// "less invasive".
const SEEN_PREFIX = '@powr/rescue_seen/';

// Beat before presenting. On a warm foreground the query serves its cached row
// first and the revision-driven invalidate lands a moment later, so deciding on
// the very first render can announce an 'offered' rescue that the server already
// flipped to 'saved'. Waiting costs a blink and means the modal that appears is
// the one that matches the server. Also keeps the sheet from mounting into the
// home screen's first paint, where RN occasionally drops the presentation.
const SETTLE_MS = 700;

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

// Pips read instantly for a 2-session challenge; a bar is the only sane form
// for a 15,000-step one. Same information either way.
const MAX_PIPS = 6;

function hoursLeft(expiresAt: string): number {
  return Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 3600_000));
}

export function StreakRescueModal({
  rescue,
  reopenNonce = 0,
  deferred = false,
}: {
  rescue: StreakRescueOffer | null;
  /** Increment to re-open on user request (tapping the StreakCard readout).
   *  Bypasses the seen-marker — user-initiated is never nagging. */
  reopenNonce?: number;
  /** Another modal owns the screen. Two RN <Modal>s presented at once means one
   *  of them silently never appears on iOS — and a rescue completing awards
   *  points, so the level-up celebration is exactly the modal most likely to be
   *  up at the same instant. Hold, don't drop: the announcement is only marked
   *  seen on dismissal, so it presents as soon as this clears. */
  deferred?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  // Banked progress joins the key on countable challenges, so crossing 1-of-2
  // re-announces exactly once ("just 1 left") instead of the user having to tap
  // the StreakCard readout to discover they're one away. Steps are excluded:
  // they advance continuously, so every open would be a new key.
  const progressPart = rescue && rescue.state === 'offered' && rescue.requirementType !== 'steps'
    ? `/${Math.min(Math.max(rescue.sessionsDone, 0), rescue.sessionsRequired)}`
    : '';
  const seenKey = rescue ? `${SEEN_PREFIX}${rescue.id}/${rescue.state}${progressPart}` : null;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!seenKey) { setVisible(false); return; }
    // Gate the transition to visible only — never yank a sheet the user is
    // already reading if something else goes pending mid-read.
    if (deferred) return;
    AsyncStorage.getItem(seenKey)
      .then((seen) => {
        if (cancelled || seen) return;
        timer = setTimeout(() => { if (!cancelled) setVisible(true); }, SETTLE_MS);
      })
      .catch(() => { /* storage unreadable — stay quiet rather than nag */ });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [seenKey, deferred]);

  useEffect(() => {
    if (reopenNonce > 0 && rescue) setVisible(true);
  }, [reopenNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    setVisible(false);
    if (seenKey) AsyncStorage.setItem(seenKey, '1').catch(() => {});
  };

  if (!rescue) return null;
  const saved = rescue.state === 'saved';

  // Progress is server-owned (a trigger advances sessions_done as qualifying
  // sessions land), so the modal can always answer "what's left?" rather than
  // restating the full requirement at someone already halfway through it.
  const done = Math.min(Math.max(rescue.sessionsDone, 0), rescue.sessionsRequired);
  const remaining = Math.max(0, rescue.sessionsRequired - done);
  const partway = !saved && done > 0;
  const usePips = rescue.requirementType !== 'steps' && rescue.sessionsRequired <= MAX_PIPS;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, saved && styles.sheetSaved]}>
          <View style={[styles.iconRing, saved && styles.iconRingSaved]}>
            <Ionicons name={saved ? 'flame' : 'bandage-outline'} size={30} color={saved ? GOLD : ORANGE} />
          </View>

          <Text style={styles.kicker}>
            {saved ? 'RESCUE COMPLETE' : partway ? 'RESCUE IN PROGRESS' : 'STREAK RESCUE'}
          </Text>
          <Text style={styles.title}>
            {saved ? 'Streak saved' : (rescue.label || 'Save your streak')}
          </Text>

          <Text style={styles.body}>
            {saved
              ? `You did the work — your ${rescue.lostStreak}-day streak is back and counting. Protect it tonight.`
              : partway
                ? `Just ${requirementPhrase(rescue.requirementType, remaining)} left in the next ${hoursLeft(rescue.expiresAt)}h and your ${rescue.lostStreak}-day streak comes all the way back.`
                : `Your ${rescue.lostStreak}-day streak isn't gone yet. ${requirementPhrase(rescue.requirementType, rescue.sessionsRequired)} in the next ${hoursLeft(rescue.expiresAt)}h brings the whole thing back.`}
          </Text>

          {!saved && rescue.sessionsRequired > 0 && (
            <View style={styles.progress}>
              {usePips ? (
                <View style={styles.pips}>
                  {Array.from({ length: rescue.sessionsRequired }, (_, i) => (
                    <View key={i} style={[styles.pip, i < done && styles.pipDone]} />
                  ))}
                </View>
              ) : (
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.round((done / rescue.sessionsRequired) * 100)}%` as any },
                    ]}
                  />
                </View>
              )}
              <Text style={styles.progressLabel}>
                {`${done.toLocaleString()} of ${requirementPhrase(rescue.requirementType, rescue.sessionsRequired)} done`}
              </Text>
            </View>
          )}

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
              {saved ? 'KEEP IT ROLLING' : partway ? 'FINISH IT' : "LET'S GO"}
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
  progress: {
    width: '100%',
    alignItems: 'center',
    gap: 7,
    marginTop: 6,
    marginBottom: 10,
  },
  pips: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  pip: {
    flex: 1,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(249,115,22,0.18)',
  },
  pipDone: {
    backgroundColor: ORANGE,
  },
  track: {
    width: '100%',
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(249,115,22,0.18)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  progressLabel: {
    color: ORANGE,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
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
