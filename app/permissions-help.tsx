import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import { useGymRelevance } from '@/hooks/useGymRelevance';
import { androidOpenHealthConnectSettings } from '@/hooks/useHealthData';
import { requestBatteryOptimizationExemption } from '@/lib/batteryOptimization';
import { openAppLocationSettings } from '@/lib/openAppSettings';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const GREEN   = '#4ade80';
const AMBER   = '#fbbf24';
const RED     = '#ef4444';

const isIOS = Platform.OS === 'ios';

// ─── Status model ─────────────────────────────────────────────────────────────

type Status = 'ok' | 'limited' | 'off' | 'unknown';

// Labels are catalog keys, resolved at render.
const STATUS_META: Record<Status, { label: string; color: string }> = {
  ok:      { label: 'settings:permissionsHelp.status.ok',      color: GREEN },
  limited: { label: 'settings:permissionsHelp.status.limited', color: AMBER },
  off:     { label: 'settings:permissionsHelp.status.off',     color: RED   },
  unknown: { label: 'settings:permissionsHelp.status.unknown', color: DIM   },
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PermissionsHelpScreen() {
  const insets = useSafeAreaInsets();
  const gymRelevant = useGymRelevance();
  const router = useRouter();
  const { t } = useTranslation();

  const [locationStatus, setLocationStatus] = useState<Status>('unknown');
  const [notifStatus, setNotifStatus]       = useState<Status>('unknown');

  // Re-read on focus so badges update after the user returns from system settings.
  const refresh = useCallback(async () => {
    const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (fg) {
      if (fg.status !== 'granted') setLocationStatus('off');
      else if (bg && bg.status !== 'granted') setLocationStatus('limited');
      else setLocationStatus('ok');
    }
    const notif = await Notifications.getPermissionsAsync().catch(() => null);
    if (notif) setNotifStatus(notif.status === 'granted' ? 'ok' : 'off');
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const openAppleHealth = () => {
    Linking.openURL('x-apple-health://').catch(() => Linking.openSettings());
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings:permissionsHelp.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          {t('settings:permissionsHelp.intro')}
        </Text>

        {/* ── Location ──────────────────────────────────────── */}
        <PermissionCard
          icon="location-outline"
          title={t('settings:permissionsHelp.location.title')}
          status={locationStatus}
          why={gymRelevant ? t('settings:permissionsHelp.location.whyGym') : t('settings:permissionsHelp.location.whyVenue')}
          steps={
            isIOS
              ? [
                  t('settings:permissionsHelp.location.ios.step1'),
                  t('settings:permissionsHelp.location.ios.step2'),
                  t('settings:permissionsHelp.location.ios.step3'),
                ]
              : [
                  t('settings:permissionsHelp.location.android.step1'),
                  t('settings:permissionsHelp.location.android.step2'),
                  t('settings:permissionsHelp.location.android.step3'),
                ]
          }
          note={
            locationStatus === 'limited'
              ? isIOS
                ? (gymRelevant ? t('settings:permissionsHelp.location.noteIosGym') : t('settings:permissionsHelp.location.noteIosVenue'))
                : (gymRelevant ? t('settings:permissionsHelp.location.noteAndroidGym') : t('settings:permissionsHelp.location.noteAndroidVenue'))
              : undefined
          }
          buttonLabel={t('settings:permissionsHelp.openSettings')}
          onPress={openAppLocationSettings}
        />

        {/* ── Background activity (Android only) ─────────────── */}
        {Platform.OS === 'android' && (
          <PermissionCard
            icon="battery-charging-outline"
            title={t('settings:permissionsHelp.battery.title')}
            status="unknown"
            why={gymRelevant ? t('settings:permissionsHelp.battery.whyGym') : t('settings:permissionsHelp.battery.whyVenue')}
            steps={[
              t('settings:permissionsHelp.battery.step1'),
              t('settings:permissionsHelp.battery.step2'),
              t('settings:permissionsHelp.battery.step3'),
            ]}
            buttonLabel={t('settings:permissionsHelp.openSettings')}
            onPress={() => { requestBatteryOptimizationExemption(); }}
          />
        )}

        {/* ── Notifications ─────────────────────────────────── */}
        <PermissionCard
          icon="notifications-outline"
          title={t('settings:permissionsHelp.notifications.title')}
          status={notifStatus}
          why={gymRelevant ? t('settings:permissionsHelp.notifications.whyGym') : t('settings:permissionsHelp.notifications.whyVenue')}
          steps={
            isIOS
              ? [
                  t('settings:permissionsHelp.notifications.ios.step1'),
                  t('settings:permissionsHelp.notifications.ios.step2'),
                  t('settings:permissionsHelp.notifications.ios.step3'),
                ]
              : [
                  t('settings:permissionsHelp.notifications.android.step1'),
                  t('settings:permissionsHelp.notifications.android.step2'),
                  t('settings:permissionsHelp.notifications.android.step3'),
                ]
          }
          buttonLabel={t('settings:permissionsHelp.openSettings')}
          onPress={() => Linking.openSettings()}
        />

        {/* ── Health ────────────────────────────────────────── */}
        <PermissionCard
          icon="heart-outline"
          title={isIOS ? 'Apple Health' : 'Health Connect'}
          status="unknown"
          why={t('settings:permissionsHelp.health.why')}
          steps={
            isIOS
              ? [
                  t('settings:permissionsHelp.health.ios.step1'),
                  t('settings:permissionsHelp.health.ios.step2'),
                  t('settings:permissionsHelp.health.ios.step3'),
                ]
              : [
                  t('settings:permissionsHelp.health.android.step1'),
                  t('settings:permissionsHelp.health.android.step2'),
                  t('settings:permissionsHelp.health.android.step3'),
                ]
          }
          buttonLabel={isIOS ? t('settings:permissionsHelp.health.openAppleHealth') : t('settings:permissionsHelp.health.openHealthConnect')}
          onPress={isIOS ? openAppleHealth : () => androidOpenHealthConnectSettings()}
        />

        <Text style={styles.footer}>
          {t('settings:permissionsHelp.footer')}
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Permission card ──────────────────────────────────────────────────────────

function PermissionCard({
  icon,
  title,
  status,
  why,
  steps,
  note,
  buttonLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  status: Status;
  why: string;
  steps: string[];
  note?: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name={icon} size={18} color={DIM} style={styles.cardIcon} />
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={[styles.statusPill, { borderColor: meta.color }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>{t(meta.label)}</Text>
        </View>
      </View>

      <Text style={styles.why}>{why}</Text>

      {note ? (
        <View style={styles.noteRow}>
          <Ionicons name="alert-circle-outline" size={14} color={AMBER} />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}

      <View style={styles.steps}>
        {steps.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        onPress={onPress}
      >
        <Text style={styles.buttonLabel}>{buttonLabel}</Text>
        <Ionicons name="open-outline" size={15} color="#0d0d0d" />
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

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
  headerSpacer: { width: 36 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 8 },

  intro: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 2,
  },

  // Card
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  cardIcon: { flexShrink: 0 },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  why: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
    lineHeight: 19,
  },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: 8,
    padding: 8,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '300',
    color: AMBER,
    lineHeight: 17,
  },

  steps: {
    marginTop: 14,
    gap: 10,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(232,210,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD,
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '300',
    color: TEXT,
    lineHeight: 18,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 16,
  },
  buttonLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#0d0d0d',
  },

  footer: {
    fontSize: 12,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
    paddingHorizontal: 12,
  },
});
