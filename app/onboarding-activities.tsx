import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { type ActivitySelection } from '@/constants/activityCatalog';
import { updateActivitySelections } from '@/lib/api/user';
import { ActivityIcon } from '@/components/ActivityIcon';
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

// Gym is the core of POWR (geofence-verified check-ins) — it's always selected
// and cannot be deselected. It renders as a full-width locked banner above the
// picker; the user picks 2 specific activities (Padel, Boxing, Zumba…) from
// the catalog, each mapping to a scoring bucket under the hood.
const LOCKED: ActivityType = 'gym';
const MAX_PICKS = 2;

export default function OnboardingActivitiesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const providers = useHealthProviders();
  const [selections, setSelections] = useState<ActivitySelection[]>([]);

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
    router.push('/onboarding-health');
  };

  const canContinue = selections.length === MAX_PICKS;
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
          Gym is your core — pick the 2 other ways you actually move.
        </Text>
      </Animated.View>

      <Animated.View style={[styles.listWrap, { opacity: listFade }]}>
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Gym: locked in, full width — not one of the choices */}
          <View style={styles.gymBanner}>
            <View style={styles.gymBannerIcon}>
              <ActivityIcon activity={ACTIVITIES[LOCKED]} size={20} color="#FFFFFF" active />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gymBannerTitle}>Gym</Text>
              <Text style={styles.gymBannerSub}>Geofence-verified check-ins — locked in</Text>
            </View>
            <View style={styles.lockCircle}>
              <Ionicons name="lock-closed" size={12} color={GOLD} />
            </View>
          </View>

          <ActivityCatalogPicker
            selections={selections}
            onChange={setSelections}
            maxPicks={MAX_PICKS}
            autoBuckets={supported}
            onConnectWearable={() => router.push('/onboarding-wearables')}
          />
        </ScrollView>
      </Animated.View>

      <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 24, opacity: buttonFade }]}>
        {remaining > 0 && (
          <Text style={styles.hint}>
            Pick {remaining} more {remaining === 1 ? 'activity' : 'activities'}
          </Text>
        )}
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

  gymBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.35)',
    backgroundColor: 'rgba(232,210,0,0.05)',
  },
  gymBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gymBannerTitle: {
    color: '#F2F2F2',
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  gymBannerSub: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontFamily: FONT_LIGHT,
    fontWeight: '300',
    marginTop: 1,
  },
  lockCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(232,210,0,0.5)',
    backgroundColor: 'rgba(232,210,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
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
