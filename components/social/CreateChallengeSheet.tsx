import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
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
import type { ChallengeTemplate, Friend, IconSpec } from '@/lib/social/types';
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
}

export function CreateChallengeSheet({
  visible,
  templates,
  friends,
  onClose,
  onCreate,
}: CreateChallengeSheetProps) {
  const insets = useSafeAreaInsets();
  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? templates[0],
    [templateId, templates],
  );

  // Group = you + invited friends. Best-case bonus assumes everyone finishes.
  const groupSize = selected.size + 1;
  const projectedBonus = groupBonus(selected.size); // co-completers = invited friends
  const atCap = selected.size >= MAX_GROUP - 1;

  const toggleFriend = (id: string) => {
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
            <Pressable hitSlop={10} onPress={handleClose}>
              <Ionicons name="close" size={22} color={MUTED} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 18 }}>
            {/* ── Pick a challenge ── */}
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
                      onPress={() => setTemplateId(t.id)}
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

            {/* ── Invite friends ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>Invite friends</Text>
                <Text style={styles.capHint}>
                  {selected.size}/{MAX_GROUP - 1} selected
                </Text>
              </View>

              <View style={styles.friendGrid}>
                {friends.map((f) => {
                  const isSel = selected.has(f.id);
                  const disabled = !isSel && atCap;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => toggleFriend(f.id)}
                      disabled={disabled}
                      style={[styles.friendCell, disabled && { opacity: 0.35 }]}
                    >
                      <Avatar friend={f} size={52} selected={isSel} />
                      <Text style={styles.friendName} numberOfLines={1}>
                        {f.displayName.split(' ')[0]}
                      </Text>
                    </Pressable>
                  );
                })}

                {/* Share-link recruitment — pull in someone not yet a friend */}
                <Pressable style={styles.friendCell} onPress={handleShareLink}>
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
                    +{projectedBonus} each if all finish{atCap ? ' (max)' : ''}
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
          </View>
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

  // friend grid
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
});
