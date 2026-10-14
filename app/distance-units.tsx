import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { setDistancePreference, useDistancePreference, type DistancePreference } from '@/lib/units';

// ─── Design tokens (Settings) ─────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

/**
 * Settings › Distance units. "Automatic" is the default and what everyone had
 * before the setting existed: miles on Discover, and each sport in the units
 * the phone's region uses for it (see lib/units). Miles or Kilometres puts
 * Discover and every land sport in that unit; swims stay in metres. The pick
 * lives on this device, like the language.
 */
export default function DistanceUnitsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const selected = useDistancePreference();

  const choose = useCallback((next: DistancePreference) => {
    Haptics.selectionAsync().catch(() => {});
    void setDistancePreference(next);
  }, []);

  // Keys in full so the catalog test can find them.
  const options: { value: DistancePreference; label: string; sublabel?: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { value: 'auto', label: t('settings:units.auto'), icon: 'phone-portrait-outline' },
    { value: 'mi', label: t('settings:units.miles'), sublabel: t('settings:units.milesDetail') },
    { value: 'km', label: t('settings:units.kilometres'), sublabel: t('settings:units.kilometresDetail') },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.back')}
        >
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings:units.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hint}>{t('settings:units.hint')}</Text>
        <View style={styles.card} accessibilityRole="radiogroup">
          {options.map((option, i) => (
            <UnitRow
              key={option.value}
              label={option.label}
              sublabel={option.sublabel}
              icon={option.icon}
              selected={selected === option.value}
              onPress={() => choose(option.value)}
              isLast={i === options.length - 1}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('settings:units.swimNote')}</Text>
      </ScrollView>
    </View>
  );
}

function UnitRow({
  label,
  sublabel,
  icon,
  selected,
  onPress,
  isLast,
}: {
  label: string;
  sublabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  onPress: () => void;
  isLast: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !isLast && styles.rowBorder, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {icon ? <Ionicons name={icon} size={18} color={DIM} /> : null}
      <View style={styles.rowTextBlock}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={18} color={GOLD} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.5,
    color: TEXT,
  },
  headerSpacer: {
    width: 36,
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 12,
    gap: 6,
    paddingTop: 8,
  },
  hint: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    paddingHorizontal: 4,
    paddingTop: 10,
    marginBottom: 4,
  },
  note: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowTextBlock: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
  },
  rowSublabel: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
  },
});
