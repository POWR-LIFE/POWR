import { ACTIVITY_LIST, ACTIVITIES, type ActivityType } from '@/constants/activities';
import { updateActivityPreferences } from '@/lib/api/user';
import { ActivityIcon } from '@/components/ActivityIcon';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { supportedActivitiesFor, type HealthProviderId } from '@/lib/health/providers';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const MAX_SELECTED = 3;
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

// Activities in display order: gym first (highest scoring), then walk → cycle → run, then the rest
const PINNED: ActivityType[] = ['gym', 'walking', 'cycling', 'running'];
const ORDERED_ACTIVITIES = [
  ...PINNED.map(t => ACTIVITIES[t]),
  ...ACTIVITY_LIST.filter(a => !PINNED.includes(a.type) && !a.hideFromPicker),
];

// Gym is the core of POWR (geofence-verified check-ins) — it's always selected
// and cannot be deselected. The user picks the remaining 2 of 3 slots.
const LOCKED: ActivityType = 'gym';

export default function OnboardingActivitiesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ streakDays?: string; totalSessions?: string; activeDays?: string }>();
  const providers = useHealthProviders();
  const [selected, setSelected] = useState<Set<ActivityType>>(new Set([LOCKED]));

  const connectedIds = useMemo<HealthProviderId[]>(
    () => providers.rows.filter(r => !!r.connection).map(r => r.meta.id),
    [providers.rows],
  );
  const supported = useMemo(() => supportedActivitiesFor(connectedIds), [connectedIds]);

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

  const toggleActivity = (type: ActivityType) => {
    if (type === LOCKED) return; // gym is locked in — can't be deselected
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else if (next.size < MAX_SELECTED) {
        next.add(type);
      }
      return next;
    });
  };

  const handleContinue = () => {
    // Persist in the background — the next screen doesn't read preferences, so
    // don't block the transition on 3 sequential network round-trips.
    updateActivityPreferences(Array.from(selected)).catch(() => {});
    router.push({
      pathname: '/onboarding-achievement',
      params: {
        ...(params.streakDays ? { streakDays: params.streakDays } : {}),
        ...(params.totalSessions ? { totalSessions: params.totalSessions } : {}),
        ...(params.activeDays ? { activeDays: params.activeDays } : {}),
      },
    });
  };

  const canContinue = selected.size === MAX_SELECTED;
  const remaining = MAX_SELECTED - selected.size;

  return (
    <View style={styles.container}>
      <GeometricBackground />

      <Pressable
          style={[styles.backButton, { top: insets.top + 14 }]}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/onboarding-health');
            }
          }}
          hitSlop={24}
        >
          <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
        </Pressable>

      <Animated.View style={[styles.header, { paddingTop: insets.top + 56, opacity: headerFade }]}>
        <Text style={styles.eyebrow}>STEP 4 OF 5</Text>
        <Text style={styles.headline}>Pick your movements</Text>
        <Text style={styles.subhead}>
          Gym stays locked in — it's how POWR verifies you were there. Pick 2 more.
        </Text>
      </Animated.View>

      <Animated.View style={[styles.gridWrap, { opacity: listFade }]}>
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
        {ORDERED_ACTIVITIES.map(activity => {
          const isLocked = activity.type === LOCKED;
          const isActive = selected.has(activity.type);
          const isAutoTracked = supported.has(activity.type);
          const isDisabled = !isActive && selected.size >= MAX_SELECTED;

          return (
            <Pressable
              key={activity.type}
              style={[
                styles.card,
                isActive && styles.cardActive,
                isLocked && styles.cardLocked,
                isDisabled && styles.cardDisabled,
                !isAutoTracked && !isActive && styles.cardManual,
              ]}
              onPress={() => toggleActivity(activity.type)}
            >
              {/* Top row: icon + check (or lock for gym) */}
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
                  <ActivityIcon
                    activity={activity}
                    size={20}
                    color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.4)'}
                    active={isActive}
                  />
                </View>
                {isLocked ? (
                  <View style={styles.lockCircle}>
                    <Ionicons name="lock-closed" size={12} color={GOLD} />
                  </View>
                ) : (
                  <View style={[styles.checkCircle, isActive && styles.checkCircleActive]}>
                    {isActive && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                  </View>
                )}
              </View>

              {/* Label */}
              <Text style={[styles.cardLabel, isActive && styles.cardLabelActive]} numberOfLines={1}>
                {activity.label}
              </Text>

              {/* Badges */}
              <View style={styles.badgeRow}>
                <View style={[styles.ptsBadge, isActive && styles.ptsBadgeActive]}>
                  <Text style={[styles.ptsText, isActive && styles.ptsTextActive]}>
                    {activity.dailyCap} PTS
                  </Text>
                </View>
                <View style={[styles.wearableBadge, isActive && styles.wearableBadgeActive]}>
                  <Ionicons
                    name={isAutoTracked ? 'flash-outline' : 'create-outline'}
                    size={9}
                    color={isActive ? GOLD : 'rgba(255,255,255,0.35)'}
                  />
                  <Text style={[styles.wearableText, isActive && styles.wearableTextActive]}>
                    {isAutoTracked ? 'AUTO' : 'MANUAL'}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
        </ScrollView>
      </Animated.View>

      <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 24, opacity: buttonFade }]}>
        {remaining > 0 && (
          <Text style={styles.hint}>
            Select {remaining} more {remaining === 1 ? 'activity' : 'activities'}
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

  header: { paddingHorizontal: 28, marginBottom: 20 },
  eyebrow: { color: 'rgba(255,255,255,0.22)', fontSize: 10, fontWeight: '600', letterSpacing: 2.5, marginBottom: 6 },
  headline: { color: '#F2F2F2', fontSize: 36, fontFamily: FONT_LIGHT, fontWeight: '200', letterSpacing: -1, lineHeight: 42, marginBottom: 8 },
  headlineGold: { color: GOLD, fontWeight: '700' },
  subhead: { color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: FONT_LIGHT, fontWeight: '300', lineHeight: 18 },
  body: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '300', lineHeight: 20 },

  gridWrap: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    alignContent: 'flex-start',
  },

  card: {
    width: '47%',
    backgroundColor: CARD_BG,
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardActive: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  cardLocked: {
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.35)',
    backgroundColor: 'rgba(232,210,0,0.05)',
  },
  cardDisabled: {
    opacity: 0.35,
  },
  cardManual: {
    opacity: 0.6,
  },

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: 'transparent',
  },

  cardLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  cardLabelActive: {
    color: '#F2F2F2',
  },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  ptsBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ptsBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  ptsText: {
    fontSize: 9,
    fontFamily: FONT_BOLD,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.35)',
  },
  ptsTextActive: {
    color: 'rgba(255,255,255,0.75)',
  },

  wearableBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  wearableBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  wearableText: {
    fontSize: 8,
    fontFamily: FONT_BOLD,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.35)',
  },
  wearableTextActive: {
    color: 'rgba(255,255,255,0.75)',
  },

  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.8)',
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
