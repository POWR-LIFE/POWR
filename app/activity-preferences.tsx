import { ACTIVITY_LIST, ACTIVITIES, type ActivityType } from '@/constants/activities';
import { updateActivityPreferences } from '@/lib/api/user';
import { useAuth } from '@/context/AuthContext';
import { ActivityIcon } from '@/components/ActivityIcon';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const DIM = 'rgba(255,255,255,0.5)';
const TEXT_COLOR = '#F2F2F2';
const MAX_SELECTED = 3;

const ORDERED_ACTIVITIES = [
  ACTIVITIES.gym,
  ...ACTIVITY_LIST.filter(a => a.type !== 'gym'),
];

export default function ActivityPreferencesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const savedPrefs: ActivityType[] =
    user?.user_metadata?.activity_preferences ?? ['gym', 'running', 'walking'];
  const [selected, setSelected] = useState<Set<ActivityType>>(new Set(savedPrefs));
  const [saving, setSaving] = useState(false);

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

  const handleSave = async () => {
    if (selected.size !== MAX_SELECTED) return;
    setSaving(true);
    await updateActivityPreferences(Array.from(selected));
    setSaving(false);
    router.back();
  };

  const canSave = selected.size === MAX_SELECTED;
  const remaining = MAX_SELECTED - selected.size;

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
          Gym is your foundation. Pick two more to track.
        </Text>
      </View>

      {/* Grid */}
      <View style={styles.grid}>
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
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
                  <ActivityIcon
                    activity={activity}
                    size={20}
                    color={isActive ? GOLD : 'rgba(255,255,255,0.4)'}
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

              <Text style={[styles.cardLabel, isActive && styles.cardLabelActive]} numberOfLines={1}>
                {activity.label}
              </Text>

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
      </View>

      {/* Bottom */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        {remaining > 0 && (
          <Text style={styles.hint}>
            Select {remaining} more {remaining === 1 ? 'activity' : 'activities'}
          </Text>
        )}
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

  intro: { paddingHorizontal: 28, marginBottom: 20 },
  headline: { color: TEXT_COLOR, fontSize: 36, fontWeight: '200', letterSpacing: -1, lineHeight: 42, marginBottom: 8 },
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
  cardDisabled: { opacity: 0.35 },

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  iconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.8)',
  },

  cardLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  cardLabelActive: { color: TEXT_COLOR },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  ptsBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  ptsBadgeActive: {
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
  },
  ptsText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: 'rgba(255,255,255,0.25)' },
  ptsTextActive: { color: GOLD },

  wearableBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  wearableBadgeActive: {
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
  },
  wearableText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: 'rgba(255,255,255,0.35)' },
  wearableTextActive: { color: GOLD },

  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },

  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.8)',
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
