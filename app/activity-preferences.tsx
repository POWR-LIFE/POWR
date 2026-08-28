import { type ActivityType } from '@/constants/activities';
import {
  genericEntryForBucket,
  toSelection,
  type ActivitySelection,
} from '@/constants/activityCatalog';
import { updateActivitySelections } from '@/lib/api/user';
import { MAX_RING_SLOTS } from '@/lib/weeklyActivities';
import { useAuth } from '@/context/AuthContext';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { supportedActivitiesFor, WEARABLE_PROVIDERS, type HealthProviderId } from '@/lib/health/providers';
import ActivityCatalogPicker from '@/components/ActivityCatalogPicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const DIM = 'rgba(255,255,255,0.5)';
const TEXT_COLOR = '#F2F2F2';

// Gym is an ordinary pick since 2026-08-28 (it was a locked, non-removable
// slot before) — see onboarding-activities.tsx. Up to MAX_RING_SLOTS picks,
// at least one.
const MAX_PICKS = MAX_RING_SLOTS;
const MIN_PICKS = 1;

/**
 * Initial picks: prefer stored concrete selections; legacy bucket-only users
 * (pre-catalog) get their buckets mapped to the closest catalog entry so the
 * screen shows something sensible to edit.
 */
function initialSelections(meta: Record<string, any> | undefined): ActivitySelection[] {
  const stored = meta?.activity_selections;
  if (Array.isArray(stored) && stored.length > 0) {
    const valid = stored.filter(
      (s: any) =>
        s &&
        typeof s.slug === 'string' &&
        typeof s.bucket === 'string' &&
        typeof s.label === 'string' &&
        s.label.length > 0,
    );
    if (valid.length > 0) return valid.slice(0, MAX_PICKS);
  }
  // Legacy profiles always carry 'gym' (it was force-prepended) — it maps to
  // the catalog's gym entry like any other bucket and the user can untick it.
  const buckets: ActivityType[] = meta?.activity_preferences ?? ['gym', 'running', 'walking'];
  return buckets
    .slice(0, MAX_PICKS)
    .map(b => {
      const entry = genericEntryForBucket(b);
      return entry ? toSelection(entry) : null;
    })
    .filter((s): s is ActivitySelection => s !== null);
}

export default function ActivityPreferencesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const providers = useHealthProviders();

  const connectedIds = useMemo<HealthProviderId[]>(
    () => providers.rows.filter(r => !!r.connection).map(r => r.meta.id),
    [providers.rows],
  );
  // Auto = phone baseline + connected-wearable capabilities. Native health is
  // deliberately excluded — without a watch it can't produce sports/dance/swim
  // workouts, so counting it would over-promise (see onboarding-activities).
  const supported = useMemo(
    () => supportedActivitiesFor(connectedIds.filter(id => WEARABLE_PROVIDERS.includes(id))),
    [connectedIds],
  );

  const [selections, setSelections] = useState<ActivitySelection[]>(
    () => initialSelections(user?.user_metadata),
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (selections.length < MIN_PICKS || selections.length > MAX_PICKS) return;
    setSaving(true);
    await updateActivitySelections(selections);
    setSaving(false);
    router.back();
  };

  const canSave = selections.length >= MIN_PICKS && selections.length <= MAX_PICKS;
  const remaining = MAX_PICKS - selections.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity Focus</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Intro */}
      <View style={styles.intro}>
        <Text style={styles.headline}>
          What's your{'\n'}
          <Text style={styles.headlineGold}>focus?</Text>
        </Text>
        <Text style={styles.body}>
          {connectedIds.length > 0
            ? `Pick up to ${MAX_PICKS}. We\'ll auto-track what your devices support.`
            : `Pick up to ${MAX_PICKS}. Most need manual logging without a wearable.`}
        </Text>
      </View>

      {/* Picker */}
      <View style={styles.listWrap}>
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ActivityCatalogPicker
            selections={selections}
            onChange={setSelections}
            maxPicks={MAX_PICKS}
            autoBuckets={supported}
            onConnectWearable={() => router.push('/wearables')}
          />
        </ScrollView>
      </View>

      {/* Bottom */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        {selections.length < MIN_PICKS ? (
          <Text style={styles.hint}>Pick at least one activity</Text>
        ) : remaining > 0 ? (
          <Text style={styles.hint}>
            Room for {remaining} more {remaining === 1 ? 'activity' : 'activities'}
          </Text>
        ) : null}
        <Pressable
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!canSave || saving}
        >
          <Text style={[styles.saveLabel, !canSave && styles.saveLabelDisabled]}>
            {saving ? 'SAVING...' : 'SAVE'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },
  headerTitle: { fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT_COLOR },
  headerSpacer: { width: 36 },

  intro: { paddingHorizontal: 28, marginBottom: 16 },
  headline: { color: TEXT_COLOR, fontSize: 36, fontWeight: '200', letterSpacing: -1, lineHeight: 42, marginBottom: 8 },
  headlineGold: { color: GOLD, fontWeight: '700' },
  body: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '300', lineHeight: 20 },

  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 14,
  },


  bottom: { paddingHorizontal: 24, paddingTop: 12 },
  hint: {
    textAlign: 'center', fontSize: 12, fontWeight: '300',
    color: 'rgba(255,255,255,0.3)', marginBottom: 12,
  },
  saveButton: {
    height: 52, borderRadius: 26, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  saveButtonDisabled: { backgroundColor: 'rgba(232,210,0,0.15)' },
  saveLabel: { color: '#000', fontSize: 14, fontWeight: '700', letterSpacing: 1.5 },
  saveLabelDisabled: { color: 'rgba(255,255,255,0.2)' },
});
