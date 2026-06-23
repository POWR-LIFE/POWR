import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
import { earnedPoints, type BonusConfig, BONUS_DEFAULTS } from '@/lib/social/bonus';
import { MOCK_TEMPLATES } from '@/lib/social/mockData';
import type { IconSpec } from '@/lib/social/types';

// ─── Tokens (match admin-challenges) ──────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';
const CARD_BG = 'rgba(30,30,30,0.95)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.55)';
const FAINT = 'rgba(255,255,255,0.3)';
const INPUT_BG = '#1A1A1A';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };
const TIERS: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];

const CATEGORIES: { id: string; label: string; icon: IconSpec }[] = [
  { id: 'gym', label: 'Gym', icon: { lib: 'ion', name: 'barbell' } },
  { id: 'walking', label: 'Walking', icon: { lib: 'ion', name: 'walk' } },
  { id: 'running', label: 'Running', icon: { lib: 'mc', name: 'run' } },
  { id: 'cycling', label: 'Cycling', icon: { lib: 'ion', name: 'bicycle' } },
  { id: 'multi', label: 'All', icon: { lib: 'ion', name: 'flame' } },
];

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

/** Admin-authored shared-challenge template (preset users pick in the create sheet). */
interface AdminTemplate {
  id: string;
  category: string;
  title: string;
  goal: string;
  tier: 'easy' | 'medium' | 'hard';
  basePoints: number;
  active: boolean;
}

const SEED: AdminTemplate[] = MOCK_TEMPLATES.map((t) => ({
  id: t.id,
  category: t.category,
  title: t.title,
  goal: t.goal,
  tier: t.tier,
  basePoints: t.basePoints,
  active: true,
}));

function iconFor(category: string): IconSpec {
  return CATEGORIES.find((c) => c.id === category)?.icon ?? CATEGORIES[0].icon;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ─── Numeric stepper ──────────────────────────────────────────────────────────
function Stepper({ value, onChange, step = 5, min = 0, max = 999, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={() => onChange(clamp(value - step, min, max))} hitSlop={6}>
        <Ionicons name="remove" size={16} color={TEXT} />
      </Pressable>
      <Text style={styles.stepValue}>{value}{suffix ? <Text style={styles.stepSuffix}>{suffix}</Text> : null}</Text>
      <Pressable style={styles.stepBtn} onPress={() => onChange(clamp(value + step, min, max))} hitSlop={6}>
        <Ionicons name="add" size={16} color={TEXT} />
      </Pressable>
    </View>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function SharedChallengesAdmin() {
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState<AdminTemplate[]>(SEED);
  const [bonus, setBonus] = useState<BonusConfig>({ ...BONUS_DEFAULTS });
  const [editing, setEditing] = useState<AdminTemplate | null>(null);

  // Live preview of the bonus model with the current config.
  const sample = earnedPoints(30, 6, bonus);

  const openNew = () =>
    setEditing({ id: '', category: 'gym', title: '', goal: '', tier: 'easy', basePoints: 25, active: true });

  const saveTemplate = (t: AdminTemplate) => {
    setTemplates((prev) => {
      if (!t.id) return [{ ...t, id: `tmpl-${Date.now()}` }, ...prev];
      return prev.map((x) => (x.id === t.id ? t : x));
    });
    setEditing(null);
  };

  const removeTemplate = (id: string) => setTemplates((prev) => prev.filter((t) => t.id !== id));
  const toggleActive = (id: string) =>
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)));

  const activeCount = templates.filter((t) => t.active).length;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Group bonus config ── */}
      <Text style={styles.sectionLabel}>GROUP BONUS</Text>
      <Text style={styles.sectionHint}>
        Each finisher earns base points plus a bonus for every friend who also finishes — capped so big groups can't farm.
      </Text>
      <View style={styles.card}>
        <View style={styles.configRow}>
          <View style={styles.configText}>
            <Text style={styles.configTitle}>Points per friend</Text>
            <Text style={styles.configSub}>Added for each co-completer</Text>
          </View>
          <Stepper value={bonus.perHead} onChange={(v) => setBonus((b) => ({ ...b, perHead: v }))} step={1} min={0} max={50} />
        </View>
        <View style={[styles.configRow, styles.configDivider]}>
          <View style={styles.configText}>
            <Text style={styles.configTitle}>Max bonus</Text>
            <Text style={styles.configSub}>Hard cap on the total bonus</Text>
          </View>
          <Stepper value={bonus.maxBonus} onChange={(v) => setBonus((b) => ({ ...b, maxBonus: v }))} step={5} min={0} max={200} />
        </View>
        <View style={styles.preview}>
          <Ionicons name="flash" size={13} color={GOLD} />
          <Text style={styles.previewText}>
            Example: base 30 + finish with 6 friends ={' '}
            <Text style={styles.previewStrong}>{sample.total} pts</Text>
            <Text style={styles.previewDim}>{`  (+${sample.bonus} bonus)`}</Text>
          </Text>
        </View>
      </View>

      {/* ── Templates ── */}
      <View style={[styles.sectionRow, { marginTop: 28 }]}>
        <Text style={styles.sectionLabel}>TEMPLATES · {activeCount} live</Text>
        <Pressable style={styles.addBtn} onPress={openNew}>
          <Ionicons name="add" size={15} color="#0a0a0a" />
          <Text style={styles.addBtnText}>New</Text>
        </Pressable>
      </View>
      <Text style={styles.sectionHint}>
        Presets members pick from when they start a challenge with friends. Inactive presets are hidden in the app.
      </Text>

      <View style={{ gap: 10, marginTop: 4 }}>
        {templates.map((t) => (
          <View key={t.id} style={[styles.tmpl, !t.active && { opacity: 0.5 }]}>
            <CatIcon spec={iconFor(t.category)} size={22} color={GOLD} />
            <Pressable style={styles.tmplBody} onPress={() => setEditing(t)}>
              <Text style={styles.tmplTitle}>{t.title}</Text>
              <Text style={styles.tmplGoal} numberOfLines={1}>{t.goal}</Text>
              <View style={styles.tmplMeta}>
                <Text style={[styles.tmplTier, { color: TIER_COLOR[t.tier] }]}>{t.tier.toUpperCase()}</Text>
                <Text style={styles.metaSep}>·</Text>
                <Text style={styles.tmplPts}>+{t.basePoints} pts</Text>
              </View>
            </Pressable>
            <View style={styles.tmplActions}>
              <Pressable
                onPress={() => toggleActive(t.id)}
                style={[styles.pill, t.active ? styles.pillOn : styles.pillOff]}
                accessibilityRole="switch"
                accessibilityState={{ checked: t.active }}
                accessibilityLabel={`${t.active ? 'Hide' : 'Show'} ${t.title}`}
              >
                <Text style={[styles.pillText, t.active ? styles.pillTextOn : styles.pillTextOff]}>
                  {t.active ? 'LIVE' : 'OFF'}
                </Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => removeTemplate(t.id)} accessibilityRole="button" accessibilityLabel={`Delete ${t.title}`}>
                <Ionicons name="trash-outline" size={17} color={FAINT} />
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <TemplateEditor
        template={editing}
        onClose={() => setEditing(null)}
        onSave={saveTemplate}
      />
    </ScrollView>
  );
}

// ─── Editor modal ──────────────────────────────────────────────────────────────
function TemplateEditor({ template, onClose, onSave }: {
  template: AdminTemplate | null;
  onClose: () => void;
  onSave: (t: AdminTemplate) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<AdminTemplate | null>(template);

  React.useEffect(() => setDraft(template), [template]);
  if (!draft) return null;

  const canSave = draft.title.trim().length > 0 && draft.goal.trim().length > 0;
  const set = (patch: Partial<AdminTemplate>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <Modal visible={!!template} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{template?.id ? 'Edit template' : 'New template'}</Text>
            <Pressable hitSlop={10} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={MUTED} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 18 }}>
            {/* Title */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>TITLE</Text>
              <TextInput
                value={draft.title}
                onChangeText={(v) => set({ title: v })}
                placeholder="e.g. Back Again"
                placeholderTextColor={FAINT}
                style={styles.input}
              />
            </View>

            {/* Goal */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>GOAL</Text>
              <TextInput
                value={draft.goal}
                onChangeText={(v) => set({ goal: v })}
                placeholder="e.g. Check in 3× this week"
                placeholderTextColor={FAINT}
                style={styles.input}
              />
            </View>

            {/* Category */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>CATEGORY</Text>
              <View style={styles.chipWrap}>
                {CATEGORIES.map((c) => {
                  const on = draft.category === c.id;
                  return (
                    <Pressable key={c.id} onPress={() => set({ category: c.id })} style={[styles.chip, on && styles.chipOn]}>
                      <CatIcon spec={c.icon} size={14} color={on ? '#0a0a0a' : GOLD} />
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Tier */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>DIFFICULTY</Text>
              <View style={styles.chipWrap}>
                {TIERS.map((tier) => {
                  const on = draft.tier === tier;
                  return (
                    <Pressable key={tier} onPress={() => set({ tier })} style={[styles.chip, on && { backgroundColor: TIER_COLOR[tier], borderColor: TIER_COLOR[tier] }]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{tier.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Base points */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>BASE POINTS</Text>
              <Stepper value={draft.basePoints} onChange={(v) => set({ basePoints: v })} step={5} min={5} max={150} suffix=" pts" />
            </View>
          </ScrollView>

          <Pressable
            onPress={() => canSave && onSave(draft)}
            disabled={!canSave}
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          >
            <Text style={[styles.saveText, !canSave && { color: MUTED }]}>
              {template?.id ? 'Save changes' : 'Add template'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2, color: TEXT, textTransform: 'uppercase' },
  sectionHint: { fontFamily: fontFamily.light, fontSize: 12, color: MUTED, lineHeight: 17, marginTop: 6, marginBottom: 12 },

  card: { backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 4 },
  configRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  configDivider: { borderTopWidth: 1, borderTopColor: BORDER },
  configText: { gap: 2, flex: 1 },
  configTitle: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  configSub: { fontFamily: fontFamily.light, fontSize: 11, color: MUTED },
  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    margin: 8, marginTop: 4, padding: 10, borderRadius: 10, backgroundColor: 'rgba(232,210,0,0.07)',
  },
  previewText: { fontFamily: fontFamily.regular, fontSize: 12, color: MUTED, flex: 1 },
  previewStrong: { fontFamily: fontFamily.semiBold, color: GOLD },
  previewDim: { color: FAINT },

  // stepper
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontFamily: fontFamily.semiBold, fontSize: 16, color: TEXT, minWidth: 44, textAlign: 'center' },
  stepSuffix: { fontFamily: fontFamily.regular, fontSize: 11, color: MUTED },

  // add button
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { fontFamily: fontFamily.bold, fontSize: 12, color: '#0a0a0a' },

  // template row
  tmpl: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14 },
  tmplBody: { flex: 1, gap: 3 },
  tmplTitle: { fontFamily: fontFamily.medium, fontSize: 15, color: TEXT },
  tmplGoal: { fontFamily: fontFamily.light, fontSize: 12, color: MUTED },
  tmplMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tmplTier: { fontFamily: fontFamily.semiBold, fontSize: 10, letterSpacing: 0.5 },
  metaSep: { color: FAINT, fontSize: 11 },
  tmplPts: { fontFamily: fontFamily.regular, fontSize: 12, color: MUTED },
  tmplActions: { alignItems: 'center', gap: 10 },
  pill: { borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  pillOn: { backgroundColor: 'rgba(0,204,102,0.12)', borderColor: 'rgba(0,204,102,0.4)' },
  pillOff: { backgroundColor: 'transparent', borderColor: BORDER },
  pillText: { fontFamily: fontFamily.bold, fontSize: 9, letterSpacing: 1 },
  pillTextOn: { color: GREEN },
  pillTextOff: { color: FAINT },

  // editor modal
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, maxHeight: '90%', gap: 16 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.4 },

  field: { gap: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
  input: { backgroundColor: INPUT_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 14, height: 48, fontFamily: fontFamily.regular, fontSize: 15, color: TEXT },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: INPUT_BG },
  chipOn: { backgroundColor: GOLD, borderColor: GOLD },
  chipText: { fontFamily: fontFamily.medium, fontSize: 12, color: MUTED },
  chipTextOn: { color: '#0a0a0a' },

  saveBtn: { backgroundColor: GOLD, borderRadius: 100, paddingVertical: 15, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#2A2A2A' },
  saveText: { fontFamily: fontFamily.bold, fontSize: 13, color: '#0a0a0a', letterSpacing: 0.5 },
});
