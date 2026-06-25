import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
import { groupBonus } from '@/lib/social/bonus';
import type { ChallengeTemplate, Friend, IconSpec, SharedChallenge } from '@/lib/social/types';
import { Avatar } from './Avatar';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const SHEET_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#262626';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

/** v1 group cap (scope §0: small groups 3–6). Architecture scales to ~20 later. */
const MAX_GROUP = 6;

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

export interface CreateChallengeSheetProps {
  visible: boolean;
  templates: ChallengeTemplate[];
  friends: Friend[];
  onClose: () => void;
  onCreate: (input: { templateId: string; friendIds: string[] }) => void | Promise<unknown>;
  /** Preselect this template when the sheet opens (e.g. tapped from the browse carousel). */
  initialTemplateId?: string | null;
  /** Group-bonus config (admin-configurable) for the live "+X each" preview. */
  bonusConfig?: { perHead: number; maxBonus: number };
  /** Every concurrency slot is full — show the "finish or drop one" state instead. */
  plateFull?: boolean;
  /** Slots in use / total, for the full-plate copy. */
  openCount?: number;
  cap?: number;
  /** The challenges currently occupying slots — each offers a "Leave" to free one. */
  openChallenges?: SharedChallenge[];
  onLeave?: (challengeId: string) => void;
}

export function CreateChallengeSheet({
  visible,
  templates,
  friends,
  onClose,
  onCreate,
  initialTemplateId,
  bonusConfig,
  plateFull = false,
  openCount = 0,
  cap = 0,
  openChallenges = [],
  onLeave,
}: CreateChallengeSheetProps) {
  const insets = useSafeAreaInsets();
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? templates[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Honour the preselected template each time the sheet opens from a browse card.
  useEffect(() => {
    if (visible && initialTemplateId) setTemplateId(initialTemplateId);
  }, [visible, initialTemplateId]);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? templates[0],
    [templateId, templates],
  );

  // Group = you + invited friends. Best-case bonus assumes everyone finishes.
  const groupSize = selected.size + 1;
  const projectedBonus = groupBonus(selected.size, bonusConfig); // co-completers = invited friends
  const atGroupCap = selected.size >= MAX_GROUP - 1;

  const toggleFriend = (id: string) => {
    Haptics.selectionAsync();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_GROUP - 1) next.add(id);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setTemplateId(templates[0]?.id ?? null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSend = async () => {
    if (!template || selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({ templateId: template.id, friendIds: [...selected] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleShareLink = async () => {
    if (!template) return;
    // Deep-link recruitment (scope §4 Option 1). Code is a placeholder until the
    // backend mints a real join_code.
    const url = `https://powr.life/app?challenge=${template.id}`;
    try {
      await Share.share({
        message: `Join me on POWR: "${template.title}" — ${template.goal}. ${url}`,
        url,
      });
    } catch {
      /* user dismissed share sheet */
    }
  };

  const canSend = !!template && selected.size > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text style={styles.sheetTitle}>Challenge friends</Text>
            <Pressable hitSlop={10} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={MUTED} />
            </Pressable>
          </View>

          {plateFull ? (
            <>
              <View style={styles.plate}>
                <View style={styles.plateIcon}>
                  <Ionicons name="layers-outline" size={26} color={GOLD} />
                </View>
                <Text style={styles.plateTitle}>Your plate is full</Text>
                <Text style={styles.plateBody}>
                  You're in {openCount} of {cap} challenges. Finish your part — or drop one — to take on another.
                </Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
                {openChallenges.map((c) => (
                  <View key={c.id} style={styles.plateRow}>
                    <CatIcon spec={c.template.icon} size={20} color={GOLD} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.plateRowTitle} numberOfLines={1}>{c.template.title}</Text>
                      <Text style={styles.plateRowMeta} numberOfLines={1}>{c.template.goal} · {c.expiresIn}</Text>
                    </View>
                    <Pressable
                      style={styles.leaveBtn}
                      onPress={() => { Haptics.selectionAsync(); onLeave?.(c.id); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Leave ${c.template.title}`}
                    >
                      <Text style={styles.leaveText}>Leave</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.footer}>
                <Pressable onPress={handleClose} style={styles.plateDoneBtn}>
                  <Text style={styles.plateDoneText}>Got it</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 18 }}>
            {/* ── The challenge ── */}
            {initialTemplateId && template ? (
              /* Came from a browse card: confirm the pick, don't re-ask — straight to inviting. */
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Challenge</Text>
                <View style={styles.selectedCard}>
                  <View style={styles.selectedIcon}>
                    <CatIcon spec={template.icon} size={22} color={GOLD} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedTitle} numberOfLines={1}>{template.title}</Text>
                    <Text style={styles.selectedGoal} numberOfLines={1}>{template.goal}</Text>
                  </View>
                  <View style={styles.selectedPts}>
                    <Text style={styles.selectedPtsValue}>+{template.basePoints}</Text>
                    <Text style={styles.selectedPtsLabel}>pts</Text>
                  </View>
                </View>
              </View>
            ) : (
              /* Generic entry (header button): let them pick. */
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Pick a challenge</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipScroll}
                >
                  {templates.map((t) => {
                    const active = t.id === templateId;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => { Haptics.selectionAsync(); setTemplateId(t.id); }}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <CatIcon spec={t.icon} size={22} color={active ? '#0a0a0a' : GOLD} />
                        <Text style={[styles.chipTitle, active && styles.chipTitleActive]}>{t.title}</Text>
                        <Text style={[styles.chipGoal, active && styles.chipGoalActive]}>{t.goal}</Text>
                        <View style={styles.chipFooter}>
                          <Text style={[styles.chipPts, active && { color: '#0a0a0a' }]}>+{t.basePoints}</Text>
                          <Text style={[styles.chipTier, { color: TIER_COLOR[t.tier] }, active && { color: '#0a0a0a' }]}>
                            {t.tier}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* ── Invite friends ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>Invite friends</Text>
                <Text style={styles.capHint}>
                  {selected.size}/{MAX_GROUP - 1} selected
                </Text>
              </View>

              {friends.length === 0 && (
                <Text style={styles.noFriendsHint}>
                  No friends yet — share a link to invite anyone to join.
                </Text>
              )}

              <View style={styles.friendGrid}>
                {friends.map((f) => {
                  const isSel = selected.has(f.id);
                  const disabled = !isSel && atGroupCap;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => toggleFriend(f.id)}
                      disabled={disabled}
                      style={[styles.friendCell, disabled && { opacity: 0.35 }]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSel, disabled }}
                      accessibilityLabel={`Invite ${f.displayName}`}
                    >
                      <Avatar friend={f} size={52} selected={isSel} />
                      <Text style={styles.friendName} numberOfLines={1}>
                        {f.displayName.split(' ')[0]}
                      </Text>
                    </Pressable>
                  );
                })}

                {/* Share-link recruitment — pull in someone not yet a friend */}
                <Pressable
                  style={styles.friendCell}
                  onPress={handleShareLink}
                  accessibilityRole="button"
                  accessibilityLabel="Invite by share link"
                >
                  <View style={styles.linkBubble}>
                    <Ionicons name="link" size={22} color={GOLD} />
                  </View>
                  <Text style={[styles.friendName, { color: GOLD }]}>Link</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>

          {/* ── Summary + send ── */}
          <View style={styles.footer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>
                {selected.size === 0
                  ? 'Select friends to invite'
                  : `${selected.size} ${selected.size === 1 ? 'friend' : 'friends'} · group of ${groupSize}`}
              </Text>
              {projectedBonus > 0 && (
                <View style={styles.bonusPill}>
                  <Ionicons name="flash" size={12} color={GOLD} />
                  <Text style={styles.bonusPillText}>
                    +{projectedBonus} each if all finish{atGroupCap ? ' (max)' : ''}
                  </Text>
                </View>
              )}
            </View>

            <Pressable
              onPress={handleSend}
              disabled={!canSend || submitting}
              style={[styles.sendBtn, (!canSend || submitting) && styles.sendBtnDisabled]}
            >
              <Text style={[styles.sendText, (!canSend || submitting) && styles.sendTextDisabled]}>
                {submitting ? 'Sending…' : 'Send invites'}
              </Text>
              {canSend && !submitting && <Ionicons name="arrow-forward" size={16} color="#0a0a0a" />}
            </Pressable>

            {/* Timing is admin-set; the clock just starts once everyone's accepted. */}
            <Text style={styles.timingNote}>The challenge starts when everyone joins.</Text>
          </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '88%',
    gap: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: fontFamily.light, fontSize: 24, color: TEXT, letterSpacing: -0.4 },

  section: { gap: 12 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },
  capHint: { fontFamily: fontFamily.regular, fontSize: 11, color: MUTED },

  // challenge chips
  chipScroll: { gap: 10, paddingRight: 8 },
  chip: {
    width: 130, padding: 12, borderRadius: 16,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, gap: 8,
  },
  chipActive: { backgroundColor: GOLD, borderColor: GOLD },
  chipTitle: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT },
  chipTitleActive: { color: '#0a0a0a' },
  chipGoal: { fontFamily: fontFamily.light, fontSize: 11, color: SECONDARY, lineHeight: 15, minHeight: 30 },
  chipGoalActive: { color: 'rgba(0,0,0,0.65)' },
  chipFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipPts: { fontFamily: fontFamily.semiBold, fontSize: 13, color: GOLD },
  chipTier: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },

  // selected-challenge confirmation (browse-card entry)
  selectedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  selectedIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center',
  },
  selectedTitle: { fontFamily: fontFamily.medium, fontSize: 15, color: TEXT },
  selectedGoal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 2 },
  selectedPts: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  selectedPtsValue: { fontFamily: fontFamily.extraLight, fontSize: 22, color: GOLD, lineHeight: 22 },
  selectedPtsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  // friend grid
  noFriendsHint: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17, marginBottom: 2 },
  friendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  friendCell: { width: 56, alignItems: 'center', gap: 6 },
  friendName: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY, maxWidth: 56 },
  linkBubble: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.4)', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },

  // footer
  footer: { gap: 12, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryText: { fontFamily: fontFamily.regular, fontSize: 13, color: SECONDARY },
  bonusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(232,210,0,0.10)', borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  bonusPillText: { fontFamily: fontFamily.semiBold, fontSize: 11, color: GOLD },

  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 100, paddingVertical: 15,
  },
  sendBtnDisabled: { backgroundColor: '#2A2A2A' },
  sendText: { fontFamily: fontFamily.bold, fontSize: 13, color: '#0a0a0a', letterSpacing: 0.5 },
  sendTextDisabled: { color: MUTED },
  timingNote: { fontFamily: fontFamily.light, fontSize: 11, color: MUTED, textAlign: 'center' },

  // full-plate state (concurrency cap reached)
  plate: { alignItems: 'center', gap: 8, paddingTop: 4, paddingBottom: 6 },
  plateIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  plateTitle: { fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
  plateBody: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  plateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  plateRowTitle: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT },
  plateRowMeta: { fontFamily: fontFamily.light, fontSize: 11, color: MUTED, marginTop: 2 },
  leaveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: BORDER },
  leaveText: { fontFamily: fontFamily.medium, fontSize: 12, color: SECONDARY },
  plateDoneBtn: { backgroundColor: '#2A2A2A', borderRadius: 100, paddingVertical: 15, alignItems: 'center' },
  plateDoneText: { fontFamily: fontFamily.semiBold, fontSize: 13, color: TEXT, letterSpacing: 0.3 },
});
