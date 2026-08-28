import { type ActivitySelection } from '@/constants/activityCatalog';
import { updateActivitySelections } from '@/lib/api/user';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  DEFAULT_SELECTIONS,
  countObservedTypes,
  observedLabelList,
  preselectFromObserved,
} from '@/lib/onboarding/activities';
import { routeAfterActivities } from '@/lib/onboarding/flow';
import { MAX_RING_SLOTS } from '@/lib/weeklyActivities';
import ActivityCatalogPicker from '@/components/ActivityCatalogPicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { supportedActivitiesFor, WEARABLE_PROVIDERS, type HealthProviderId } from '@/lib/health/providers';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

// Gym used to be a locked slot (always selected, never removable). Since
// 2026-08-28 it is an ordinary pick that starts PRE-SELECTED — geofence
// check-ins are still POWR's core, but a walk/run/cycle-only user (a third of
// the active base never produces a gym session) can drop it, and every
// gym-framed surface downstream then stops assuming they go. Each pick powers
// one ring; up to MAX_RING_SLOTS picks, at least one.
const MAX_PICKS = MAX_RING_SLOTS;
const MIN_PICKS = 1;
/** How far back the wearable backfill is consulted for pre-ticking. */
const OBSERVED_LOOKBACK_DAYS = 30;

export default function OnboardingActivitiesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const providers = useHealthProviders();
  const { user } = useAuth();
  const [selections, setSelections] = useState<ActivitySelection[]>(DEFAULT_SELECTIONS);
  const [observed, setObserved] = useState<Record<string, number>>({});
  const touchedRef = useRef(false);

  // This step now runs AFTER wearables, so a freshly connected watch has its
  // Terra backfill landing as sessions already. Pre-tick from what it saw —
  // unless the user has started picking, in which case leave them alone.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    let cancelled = false;
    try {
      supabase
        .from('activity_sessions')
        .select('type')
        .eq('user_id', uid)
        .neq('type', 'sleep')
        .gte('started_at', new Date(Date.now() - OBSERVED_LOOKBACK_DAYS * 86_400_000).toISOString())
        .limit(500)
        .then(({ data }) => {
          if (cancelled || touchedRef.current) return;
          const counts = countObservedTypes(data ?? []);
          if (Object.keys(counts).length === 0) return;
          setObserved(counts);
          setSelections(preselectFromObserved(counts, { max: MAX_PICKS }));
        }, () => { /* defaults stand */ });
    } catch { /* defaults stand */ }
    return () => { cancelled = true; };
  }, [user?.id]);

  const onChange = (next: ActivitySelection[]) => { touchedRef.current = true; setSelections(next); };
  const observedLabels = observedLabelList(selections, observed);

  const connectedIds = useMemo<HealthProviderId[]>(
    () => providers.rows.filter(r => !!r.connection).map(r => r.meta.id),
    [providers.rows],
  );
  // Honest trackability: auto = the phone baseline + what a connected WEARABLE
  // covers. Native health alone is deliberately excluded — Apple Health / Health
  // Connect only contain sports/dance/swim workouts when a watch (or another
  // app) writes them, so counting native as "tracks everything" would wrongly
  // promise auto-tracking to phone-only users.
  const supported = useMemo(
    () => supportedActivitiesFor(connectedIds.filter(id => WEARABLE_PROVIDERS.includes(id))),
    [connectedIds],
  );

  const headerFade = useRef(new Animated.Value(0)).current;
  const listFade = useRef(new Animated.Value(0)).current;
  const buttonFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(headerFade, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(listFade, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(buttonFade, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleContinue = () => {
    // Persist in the background — the next screen doesn't read preferences, so
    // don't block the transition on the network round-trips.
    updateActivitySelections(selections).catch(() => {});
    router.push(routeAfterActivities(selections));
  };

  const canContinue = selections.length >= MIN_PICKS && selections.length <= MAX_PICKS;
  const remaining = MAX_PICKS - selections.length;

  return (
    <View style={styles.container}>
      <GeometricBackground />

      <Pressable
          style={[styles.backButton, { top: insets.top + 14 }]}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/onboarding-wearables');
            }
          }}
          hitSlop={24}
        >
          <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
        </Pressable>

      <Animated.View style={[styles.header, { paddingTop: insets.top + 56, opacity: headerFade }]}>
        <Text style={styles.eyebrow}>NEARLY THERE</Text>
        <Text style={styles.headline}>Pick your movements</Text>
        <Text style={styles.subhead}>
          {observedLabels
            ? `Your device already shows ${observedLabels} — we’ve ticked ${observedLabels.includes(' and ') ? 'them' : 'it'}. Adjust if you like, up to ${MAX_PICKS}.`
            : `Pick up to ${MAX_PICKS} ways you actually move. Gym is ticked to start — tap it off if that’s not you.`}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.listWrap, { opacity: listFade }]}>
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ActivityCatalogPicker
            selections={selections}
            onChange={onChange}
            maxPicks={MAX_PICKS}
            autoBuckets={supported}
            onConnectWearable={() => router.push('/onboarding-wearables')}
          />
        </ScrollView>
      </Animated.View>

      <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 24, opacity: buttonFade }]}>
        {selections.length < MIN_PICKS ? (
          <Text style={styles.hint}>Pick at least one activity</Text>
        ) : remaining > 0 ? (
          <Text style={styles.hint}>
            Room for {remaining} more {remaining === 1 ? 'activity' : 'activities'} — or continue
          </Text>
        ) : null}
        <Pressable
          style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
        >
          <Text style={[styles.primaryLabel, !canContinue && styles.primaryLabelDisabled]}>
            CONTINUE
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  backButton: { position: 'absolute', left: 16, zIndex: 20, padding: 4 },

  header: { paddingHorizontal: 28, marginBottom: 16 },
  eyebrow: { color: 'rgba(255,255,255,0.22)', fontSize: 10, fontWeight: '600', letterSpacing: 2.5, marginBottom: 6 },
  headline: { color: '#F2F2F2', fontSize: 36, fontFamily: FONT_LIGHT, fontWeight: '200', letterSpacing: -1, lineHeight: 42, marginBottom: 8 },
  subhead: { color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: FONT_LIGHT, fontWeight: '300', lineHeight: 18 },

  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 14,
  },

  bottom: {
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: FONT_LIGHT,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: 12,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: 'rgba(232,210,0,0.15)',
  },
  primaryLabel: { color: '#000', fontSize: 14, fontFamily: FONT_BOLD, fontWeight: '700', letterSpacing: 1.5 },
  primaryLabelDisabled: { color: 'rgba(255,255,255,0.2)' },
});
