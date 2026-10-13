import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { useAuth } from '@/context/AuthContext';
import { setLanguagePreference, useLanguageSettings } from '@/lib/i18n';
import { reportUserLanguage } from '@/lib/i18n/reportLanguage';
import { APP_LANGUAGES, LANGUAGE_NAMES } from '@/shared/i18n';

// ─── Design tokens (Settings) ─────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

/** A language as its own speakers write it; the bare code if we have no name. */
const nameOf = (language: string) => LANGUAGE_NAMES[language] ?? language.toUpperCase();

/**
 * Settings › Language. "Phone language" is the default and means exactly what
 * it says; any other row pins POWR to that language on this device. Drafts only
 * appear with the translation preview on (see lib/i18n).
 */
export default function LanguageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { preference, deviceLanguage, available } = useLanguageSettings();

  // A saved pick that's no longer offered (a draft with the preview off) is
  // not what's on screen, so the phone row is the honest one to tick.
  const selected = preference && available.includes(preference) ? preference : null;
  const phoneSpeaksIt = available.includes(deviceLanguage);

  const choose = useCallback(
    async (language: string | null) => {
      Haptics.selectionAsync().catch(() => {});
      await setLanguagePreference(language);
      if (user?.id) reportUserLanguage(user.id);
    },
    [user?.id],
  );

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
        <Text style={styles.headerTitle}>{t('settings:language.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hint}>{t('settings:language.hint')}</Text>
        <View style={styles.card}>
          <LanguageRow
            label={t('settings:language.phone')}
            sublabel={
              phoneSpeaksIt
                ? nameOf(deviceLanguage)
                : t('settings:language.phoneUnavailable', { language: nameOf(deviceLanguage) })
            }
            icon="phone-portrait-outline"
            selected={selected === null}
            onPress={() => choose(null)}
            isLast={available.length === 0}
          />
          {available.map((language, i) => (
            <LanguageRow
              key={language}
              label={nameOf(language)}
              badge={APP_LANGUAGES.includes(language) ? undefined : t('settings:language.draft')}
              selected={selected === language}
              onPress={() => choose(language)}
              isLast={i === available.length - 1}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function LanguageRow({
  label,
  sublabel,
  badge,
  icon,
  selected,
  onPress,
  isLast,
}: {
  label: string;
  sublabel?: string;
  badge?: string;
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
        <View style={styles.rowLabelLine}>
          <Text style={styles.rowLabel}>{label}</Text>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
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
  rowLabelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  badge: {
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.4)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1,
    color: GOLD,
    textTransform: 'uppercase',
  },
});
