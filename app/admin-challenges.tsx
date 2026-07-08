import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSessionUser, supabase } from '@/lib/supabase';
import {
  CATALOG,
  CATEGORY_META,
  CATEGORY_ORDER,
  getActiveChallengesForWeek,
  getISOWeek,
  weekNumber,
} from '@/shared/weeklyChallenges';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const GOLD        = '#E8D200';
const GREEN       = '#00CC66';
const ORANGE      = '#FF5C00';
const BG          = '#0d0d0d';
const CARD_BG     = 'rgba(30,30,30,0.95)';
const BORDER      = 'rgba(255,255,255,0.08)';
const TEXT        = '#F2F2F2';
const MUTED       = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = 'rgba(255,255,255,0.25)';
const RED         = '#ef4444';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

const CONFIG_KEY = 'challenge_week_overrides';

// ─── Types ────────────────────────────────────────────────────────────────────

type WeekOverrides = Record<string, string>; // { category: challengeId }
type AllOverrides  = Record<string, WeekOverrides>; // { isoWeek: { category: id } }

interface CatalogEntry {
  id: string;
  category: string;
  tier: string;
  title: string;
  description: string;
  points: number;
  supported?: boolean;
  rule: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentISOWeek(): string {
  return getISOWeek(new Date());
}

function weekLabel(isoWeek: string): string {
  const m = /^(\d+)-W(\d+)$/.exec(isoWeek);
  if (!m) return isoWeek;
  // Find the Monday of that week
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() + (week - 1) * 7 * 86400000 - (dayOfWeek - 1) * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function nextWeekISO(): string {
  const now = new Date();
  const next = new Date(now.getTime() + 7 * 86400000);
  return getISOWeek(next);
}

const catMeta = CATEGORY_META as Record<string, { label: string; icon: { lib: string; name: string } }>;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminChallengesScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();

  const [isAdmin, setIsAdmin]   = useState<boolean | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // The full overrides map stored in system_config
  const [allOverrides, setAllOverrides] = useState<AllOverrides>({});
  const [configRowExists, setConfigRowExists] = useState(false);

  // Which week tab is shown
  const thisWeek = currentISOWeek();
  const nextWeek = nextWeekISO();
  const [selectedWeek, setSelectedWeek] = useState(thisWeek);

  // Picker modal
  const [pickingCategory, setPickingCategory] = useState<string | null>(null);

  // ── Admin guard ────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const user = await getSessionUser();
      if (!user) { setIsAdmin(false); setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      setIsAdmin(data?.is_admin === true);
      setLoading(false);
    })();
  }, []);

  // ── Load overrides ─────────────────────────────────────────────────────────

  const loadOverrides = useCallback(async () => {
    const { data } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', CONFIG_KEY)
      .maybeSingle();
    if (data?.value) {
      try {
        const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        setAllOverrides(parsed ?? {});
        setConfigRowExists(true);
      } catch {
        setAllOverrides({});
      }
    } else {
      setConfigRowExists(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadOverrides();
  }, [isAdmin, loadOverrides]);

  // ── Auto rotation for selected week ───────────────────────────────────────

  const autoForWeek = useMemo(
    () => getActiveChallengesForWeek(selectedWeek, CATALOG as CatalogEntry[]) as CatalogEntry[],
    [selectedWeek],
  );

  const weekOverrides: WeekOverrides = allOverrides[selectedWeek] ?? {};

  /** The resolved challenge for a category: override first, else auto. */
  function resolvedChallenge(cat: string): CatalogEntry {
    const ovId = weekOverrides[cat];
    if (ovId) {
      const found = (CATALOG as CatalogEntry[]).find((c) => c.id === ovId);
      if (found) return found;
    }
    return autoForWeek.find((c) => c.category === cat)!;
  }

  // ── Persist overrides ──────────────────────────────────────────────────────

  const persistOverrides = async (next: AllOverrides) => {
    setSaving(true);
    try {
      const value = JSON.stringify(next);
      const user = await getSessionUser();
      const payload = {
        key:         CONFIG_KEY,
        value,
        description: 'Per-week challenge overrides: { isoWeek: { category: challengeId } }',
        updated_at:  new Date().toISOString(),
        updated_by:  user?.id ?? null,
      };
      const query = configRowExists
        ? supabase.from('system_config').update(payload).eq('key', CONFIG_KEY)
        : supabase.from('system_config').insert([payload]);
      const { error } = await query;
      if (error) throw error;
      setAllOverrides(next);
      setConfigRowExists(true);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const setOverride = async (cat: string, challengeId: string) => {
    const next: AllOverrides = {
      ...allOverrides,
      [selectedWeek]: { ...(allOverrides[selectedWeek] ?? {}), [cat]: challengeId },
    };
    await persistOverrides(next);
    setPickingCategory(null);
  };

  const clearOverride = async (cat: string) => {
    const weekMap = { ...(allOverrides[selectedWeek] ?? {}) };
    delete weekMap[cat];
    const next: AllOverrides = { ...allOverrides, [selectedWeek]: weekMap };
    await persistOverrides(next);
  };

  // ── Catalog for picker ─────────────────────────────────────────────────────

  const catalogForCategory = useMemo(() => {
    if (!pickingCategory) return [];
    return (CATALOG as CatalogEntry[])
      .filter((c) => c.category === pickingCategory && c.supported !== false)
      .sort((a, b) => {
        const order = { easy: 0, medium: 1, hard: 2 };
        return (order[a.tier as keyof typeof order] ?? 3) - (order[b.tier as keyof typeof order] ?? 3);
      });
  }, [pickingCategory]);

  // ── Loading / unauthorised ─────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        <Ionicons name="lock-closed-outline" size={40} color={MUTED} />
        <Text style={{ color: TEXT, fontSize: 15, fontFamily: 'Outfit_400Regular' }}>Admin access required</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: GOLD, fontSize: 14 }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>Challenges</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Week tabs */}
      <View style={styles.weekTabs}>
        {[thisWeek, nextWeek].map((week) => (
          <Pressable
            key={week}
            style={[styles.weekTab, selectedWeek === week && styles.weekTabActive]}
            onPress={() => setSelectedWeek(week)}
          >
            <Text style={[styles.weekTabLabel, selectedWeek === week && styles.weekTabLabelActive]}>
              {week === thisWeek ? 'This Week' : 'Next Week'}
            </Text>
            <Text style={[styles.weekTabSub, selectedWeek === week && styles.weekTabSubActive]}>
              {weekLabel(week)}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>ACTIVE CHALLENGES</Text>
        <Text style={styles.sectionHint}>
          5 challenges run each week — one per category. Tap a row to override which challenge shows for {selectedWeek === thisWeek ? 'this week' : 'next week'}.
        </Text>

        {CATEGORY_ORDER.map((cat) => {
          const c   = resolvedChallenge(cat);
          if (!c) return null;
          const isOverridden = !!weekOverrides[cat];
          const meta = catMeta[cat];
          return (
            <Pressable
              key={cat}
              style={({ pressed }) => [styles.challengeRow, pressed && { opacity: 0.8 }]}
              onPress={() => setPickingCategory(cat)}
            >
              <View style={styles.rowLeft}>
                <View style={styles.catBadge}>
                  <Text style={styles.catBadgeText}>{meta?.label ?? cat}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{c.title}</Text>
                    {isOverridden && (
                      <View style={styles.overridePill}>
                        <Text style={styles.overridePillText}>OVERRIDE</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowDesc} numberOfLines={1}>{c.description}</Text>
                  <View style={styles.rowMeta}>
                    <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[c.tier] ?? GOLD }]} />
                    <Text style={[styles.tierLabel, { color: TIER_COLOR[c.tier] ?? GOLD }]}>
                      {c.tier.toUpperCase()}
                    </Text>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.rowPts}>+{c.points} pts</Text>
                  </View>
                </View>
              </View>
              <View style={styles.rowRight}>
                {isOverridden && (
                  <Pressable
                    hitSlop={10}
                    onPress={(e) => { e.stopPropagation(); clearOverride(cat); }}
                    style={styles.clearBtn}
                  >
                    <Ionicons name="close-circle" size={18} color={RED} />
                  </Pressable>
                )}
                <Ionicons name="chevron-forward" size={16} color={MUTED} />
              </View>
            </Pressable>
          );
        })}

        {/* ── Full catalog overview ─────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { marginTop: 32 }]}>FULL CATALOG</Text>
        <Text style={styles.sectionHint}>
          {(CATALOG as CatalogEntry[]).filter((c) => c.supported !== false).length} challenges across 5 categories. The rotation advances by one each week automatically.
        </Text>

        {CATEGORY_ORDER.map((cat) => {
          const list = (CATALOG as CatalogEntry[]).filter(
            (c) => c.category === cat && c.supported !== false,
          );
          const wn   = weekNumber(selectedWeek);
          const autoIdx = wn % list.length;
          const meta = catMeta[cat];

          return (
            <View key={cat} style={styles.catalogSection}>
              <Text style={styles.catalogCatTitle}>{meta?.label ?? cat} — {list.length} challenges</Text>
              {list.map((c, i) => {
                const isAuto      = i === autoIdx && !weekOverrides[cat];
                const isSelected  = weekOverrides[cat] === c.id || isAuto;
                return (
                  <View
                    key={c.id}
                    style={[
                      styles.catalogRow,
                      isSelected && styles.catalogRowSelected,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.catalogRowTitle}>
                        <Text style={[styles.catalogTitle, isSelected && { color: TEXT }]}>
                          {c.title}
                        </Text>
                        {isAuto && (
                          <View style={styles.autoPill}>
                            <Text style={styles.autoPillText}>AUTO</Text>
                          </View>
                        )}
                        {weekOverrides[cat] === c.id && (
                          <View style={[styles.autoPill, { backgroundColor: 'rgba(232,210,0,0.15)', borderColor: 'rgba(232,210,0,0.3)' }]}>
                            <Text style={[styles.autoPillText, { color: GOLD }]}>PINNED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.catalogDesc}>{c.description}</Text>
                      <View style={styles.rowMeta}>
                        <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[c.tier] ?? GOLD }]} />
                        <Text style={[styles.tierLabel, { color: TIER_COLOR[c.tier] ?? GOLD }]}>
                          {c.tier.toUpperCase()}
                        </Text>
                        <Text style={styles.metaSep}>·</Text>
                        <Text style={styles.rowPts}>+{c.points} pts</Text>
                      </View>
                    </View>
                    {!isAuto && (
                      <Pressable
                        style={({ pressed }) => [styles.pinBtn, weekOverrides[cat] === c.id && styles.pinBtnActive, pressed && { opacity: 0.7 }]}
                        onPress={() =>
                          weekOverrides[cat] === c.id ? clearOverride(cat) : setOverride(cat, c.id)
                        }
                      >
                        <Text style={[styles.pinBtnText, weekOverrides[cat] === c.id && styles.pinBtnTextActive]}>
                          {weekOverrides[cat] === c.id ? 'Unpin' : 'Pin'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={GOLD} />
          <Text style={styles.savingText}>Saving…</Text>
        </View>
      )}

      {/* ── Category picker modal ─────────────────────────────────────────── */}
      <Modal
        visible={!!pickingCategory}
        animationType="slide"
        transparent
        onRequestClose={() => setPickingCategory(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {catMeta[pickingCategory ?? '']?.label ?? pickingCategory}
                </Text>
                <Text style={styles.modalSub}>Pick a challenge for {selectedWeek}</Text>
              </View>
              <Pressable onPress={() => setPickingCategory(null)}>
                <Ionicons name="close" size={22} color={TEXT} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {catalogForCategory.map((c) => {
                const isCurrentPick =
                  weekOverrides[pickingCategory ?? ''] === c.id ||
                  (!weekOverrides[pickingCategory ?? ''] &&
                    autoForWeek.find((a) => a.category === pickingCategory)?.id === c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      isCurrentPick && styles.pickerRowActive,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => pickingCategory && setOverride(pickingCategory, c.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.pickerRowTitleLine}>
                        <Text style={[styles.pickerRowTitle, isCurrentPick && { color: GOLD }]}>
                          {c.title}
                        </Text>
                        {isCurrentPick && (
                          <Ionicons name="checkmark-circle" size={16} color={GOLD} />
                        )}
                      </View>
                      <Text style={styles.pickerRowDesc}>{c.description}</Text>
                      <View style={styles.rowMeta}>
                        <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[c.tier] ?? GOLD }]} />
                        <Text style={[styles.tierLabel, { color: TIER_COLOR[c.tier] ?? GOLD }]}>
                          {c.tier.toUpperCase()}
                        </Text>
                        <Text style={styles.metaSep}>·</Text>
                        <Text style={styles.rowPts}>+{c.points} pts</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}

              {/* Reset to auto option */}
              {weekOverrides[pickingCategory ?? ''] && (
                <Pressable
                  style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => { pickingCategory && clearOverride(pickingCategory); setPickingCategory(null); }}
                >
                  <Ionicons name="refresh-outline" size={16} color={RED} />
                  <Text style={styles.resetBtnText}>Reset to auto rotation</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: TEXT, fontFamily: 'Outfit_600SemiBold' },

  weekTabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 16,
  },
  weekTab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  weekTabActive: { borderBottomColor: GOLD },
  weekTabLabel: { fontSize: 13, fontWeight: '600', color: MUTED, fontFamily: 'Outfit_600SemiBold' },
  weekTabLabelActive: { color: GOLD },
  weekTabSub: { fontSize: 10, color: PLACEHOLDER, marginTop: 2 },
  weekTabSubActive: { color: 'rgba(232,210,0,0.6)' },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 20 },

  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: MUTED,
    textTransform: 'uppercase', marginBottom: 6, fontFamily: 'Outfit_700Bold',
  },
  sectionHint: { fontSize: 12, color: PLACEHOLDER, marginBottom: 16, lineHeight: 18 },

  challengeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 10,
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  catBadge: {
    backgroundColor: 'rgba(232,210,0,0.1)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, marginTop: 1,
  },
  catBadgeText: { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 0.8, textTransform: 'uppercase' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: TEXT, flex: 1, fontFamily: 'Outfit_600SemiBold' },
  overridePill: {
    backgroundColor: 'rgba(255,92,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,92,0,0.3)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  overridePillText: { fontSize: 8, fontWeight: '700', color: ORANGE, letterSpacing: 0.8 },
  rowDesc: { fontSize: 12, color: MUTED, lineHeight: 17, marginBottom: 6 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tierDot: { width: 6, height: 6, borderRadius: 3 },
  tierLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  metaSep: { color: PLACEHOLDER, fontSize: 10 },
  rowPts: { fontSize: 11, fontWeight: '600', color: MUTED },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearBtn: { padding: 2 },

  // Catalog section
  catalogSection: { marginBottom: 24 },
  catalogCatTitle: { fontSize: 12, fontWeight: '700', color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  catalogRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    padding: 12, marginBottom: 6,
    backgroundColor: 'rgba(20,20,20,0.8)',
  },
  catalogRowSelected: { borderColor: 'rgba(232,210,0,0.25)', backgroundColor: 'rgba(232,210,0,0.05)' },
  catalogRowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  catalogTitle: { fontSize: 14, fontWeight: '500', color: MUTED, flex: 1 },
  catalogDesc: { fontSize: 11, color: PLACEHOLDER, marginBottom: 5, lineHeight: 16 },
  autoPill: {
    backgroundColor: 'rgba(0,204,102,0.12)', borderWidth: 1, borderColor: 'rgba(0,204,102,0.25)',
    borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
  },
  autoPillText: { fontSize: 8, fontWeight: '700', color: GREEN, letterSpacing: 0.8 },
  catalogRowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  pinBtn: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, marginLeft: 12,
  },
  pinBtnActive: { borderColor: 'rgba(232,210,0,0.4)', backgroundColor: 'rgba(232,210,0,0.1)' },
  pinBtnText: { fontSize: 11, fontWeight: '600', color: MUTED },
  pinBtnTextActive: { color: GOLD },

  // Saving overlay
  savingOverlay: {
    position: 'absolute', bottom: 30, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(20,20,20,0.95)', borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  savingText: { color: TEXT, fontSize: 13 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: '#141414', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, maxHeight: '85%',
    borderWidth: 1, borderColor: BORDER,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: TEXT, fontFamily: 'Outfit_600SemiBold' },
  modalSub: { fontSize: 12, color: MUTED, marginTop: 3 },

  pickerRow: {
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    marginBottom: 8, backgroundColor: 'rgba(20,20,20,0.8)',
  },
  pickerRowActive: { borderColor: 'rgba(232,210,0,0.35)', backgroundColor: 'rgba(232,210,0,0.07)' },
  pickerRowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  pickerRowTitle: { fontSize: 15, fontWeight: '600', color: TEXT, flex: 1 },
  pickerRowDesc: { fontSize: 12, color: MUTED, lineHeight: 17, marginBottom: 6 },

  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 12,
    paddingVertical: 12, marginTop: 8, marginBottom: 8,
    backgroundColor: 'rgba(239,68,68,0.07)',
  },
  resetBtnText: { fontSize: 13, color: RED, fontWeight: '600' },
});
