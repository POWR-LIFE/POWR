import { ACTIVITY_LIST, ACTIVITIES, type ActivityType } from '@/constants/activities';
import { updateActivityPreferences } from '@/lib/api/user';
import { ActivityIcon } from '@/components/ActivityIcon';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const MAX_SELECTED = 3; // gym + 2 others

// Activities in display order: gym first, then the rest
const ORDERED_ACTIVITIES = [
  ACTIVITIES.gym,
  ...ACTIVITY_LIST.filter(a => a.type !== 'gym'),
];

export default function OnboardingActivitiesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<ActivityType>>(new Set(['gym']));

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
    if (type === 'gym') return;
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

  const handleContinue = async () => {
    await updateActivityPreferences(Array.from(selected));
    router.push('/onboarding-health');
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
              router.replace('/onboarding-permission');
            }
          }}
          hitSlop={24}
        >
          <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
        </Pressable>

      <Animated.View style={[styles.header, { paddingTop: insets.top + 56, opacity: headerFade }]}>
        <Text style={styles.eyebrow}>STEP 3 OF 5</Text>
        <Text style={styles.headline}>
          What's your{'\n'}
          <Text style={styles.headlineGold}>focus?</Text>
        </Text>
        <Text style={styles.body}>
          Gym is your foundation. Pick two more to track.
        </Text>
      </Animated.View>

      <Animated.View style={[styles.grid, { opacity: listFade }]}>
        {ORDERED_ACTIVITIES.map(activity => {
          const isActive = selected.has(activity.type);
          const isGym = activity.type === 'gym';
          const needsWearable = activity.verification === 'wearable';
          const isDisabled = !isActive && selected.size >= MAX_SELECTED;

          return (
            <Pressable
              key={activity.type}
              style={[
                styles.card,
                isActive && styles.cardActive,
                isDisabled && styles.cardDisabled,
              ]}
              onPress={() => toggleActivity(activity.type)}
              disabled={isGym}
            >
              {/* Top row: icon + check/lock */}
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
                  <ActivityIcon
                    activity={activity}
                    size={20}
                    color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.4)'}
                    active={isActive}
                  />
                </View>
                {isGym ? (
                  <View style={styles.lockedBadge}>
                    <Ionicons name="lock-closed" size={9} color={GOLD} />
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
                {needsWearable && (
                  <View style={[styles.wearableBadge, isActive && styles.wearableBadgeActive]}>
                    <Ionicons
                      name="watch-outline"
                      size={9}
                      color={isActive ? GOLD : 'rgba(255,255,255,0.35)'}
                    />
                    <Text style={[styles.wearableText, isActive && styles.wearableTextActive]}>
                      WEARABLE
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
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
  headline: { color: '#F2F2F2', fontSize: 36, fontWeight: '200', letterSpacing: -1, lineHeight: 42, marginBottom: 8 },
  headlineGold: { color: GOLD, fontWeight: '700' },
  body: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '300', lineHeight: 20 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    flex: 1,
    alignContent: 'flex-start',
  },

  card: {
    width: '47%',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.15)',
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardActive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.6)',
  },
  cardDisabled: {
    opacity: 0.35,
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
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.8)',
  },

  cardLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
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
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
  },
  ptsText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.25)',
  },
  ptsTextActive: {
    color: GOLD,
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
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
  },
  wearableText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.35)',
  },
  wearableTextActive: {
    color: GOLD,
  },

  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lockedText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: GOLD,
  },

  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(232,210,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.8)',
  },

  bottom: { paddingHorizontal: 24, paddingTop: 12 },
  hint: {
    textAlign: 'center',
    fontSize: 12,
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
  primaryLabel: { color: '#000', fontSize: 14, fontWeight: '700', letterSpacing: 1.5 },
  primaryLabelDisabled: { color: 'rgba(255,255,255,0.2)' },
});
