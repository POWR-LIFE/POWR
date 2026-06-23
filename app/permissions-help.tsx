import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import { androidOpenHealthConnectSettings } from '@/hooks/useHealthData';
import { requestBatteryOptimizationExemption } from '@/lib/batteryOptimization';

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

const STATUS_META: Record<Status, { label: string; color: string }> = {
  ok:      { label: 'Enabled',  color: GREEN },
  limited: { label: 'Limited',  color: AMBER },
  off:     { label: 'Off',      color: RED   },
  unknown: { label: 'Manage',   color: DIM   },
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PermissionsHelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

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
        <Text style={styles.headerTitle}>Permissions & Setup</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          POWR needs a few permissions to earn for you automatically. Here's what each one does and
          how to fix it if it's switched off.
        </Text>

        {/* ── Location ──────────────────────────────────────── */}
        <PermissionCard
          icon="location-outline"
          title="Location"
          status={locationStatus}
          why="Detects when you arrive at a partner gym and earns points at geofenced venues — even while POWR is closed."
          steps={
            isIOS
              ? [
                  'Open Settings, then Privacy & Security',
                  'Tap Location Services, then POWR',
                  'Choose "Always" and turn on Precise Location',
                ]
              : [
                  'Open Settings, then Apps › POWR',
                  'Tap Permissions › Location',
                  'Choose "Allow all the time" and "Precise"',
                ]
          }
          note={
            locationStatus === 'limited'
              ? isIOS
                ? 'Location is on, but not set to "Always" — POWR can\'t detect gym arrivals when it\'s closed.'
                : 'Location is on, but not "Allow all the time" — POWR can\'t detect gym arrivals when it\'s closed.'
              : undefined
          }
          buttonLabel="Open Settings"
          onPress={() => Linking.openSettings()}
        />

        {/* ── Background activity (Android only) ─────────────── */}
        {Platform.OS === 'android' && (
          <PermissionCard
            icon="battery-charging-outline"
            title="Background activity"
            status="unknown"
            why="Lets POWR keep detecting gym arrivals when the app is fully closed. Without it, Android can sleep the app and miss check-ins."
            steps={[
              'Tap Open Settings below',
              'Allow POWR to ignore battery optimisation',
              'Or set Battery to "Unrestricted" on POWR\'s app page',
            ]}
            buttonLabel="Open Settings"
            onPress={() => { requestBatteryOptimizationExemption(); }}
          />
        )}

        {/* ── Notifications ─────────────────────────────────── */}
        <PermissionCard
          icon="notifications-outline"
          title="Notifications"
          status={notifStatus}
          why="Confirms gym check-ins, tells you when points land, and alerts you to rewards you can claim."
          steps={
            isIOS
              ? [
                  'Open Settings, then Notifications',
                  'Find POWR in the list',
                  'Turn on Allow Notifications',
                ]
              : [
                  'Open Settings, then Apps › POWR',
                  'Tap Notifications',
                  'Turn notifications on',
                ]
          }
          buttonLabel="Open Settings"
          onPress={() => Linking.openSettings()}
        />

        {/* ── Health ────────────────────────────────────────── */}
        <PermissionCard
          icon="heart-outline"
          title={isIOS ? 'Apple Health' : 'Health Connect'}
          status="unknown"
          why="Reads your steps, workouts and sleep so they can be verified and turned into points — no wearable required."
          steps={
            isIOS
              ? [
                  'Open the Health app',
                  'Tap your profile photo (top-right), then Privacy › Apps',
                  'Tap POWR and turn on the categories you want to share',
                ]
              : [
                  'Tap Open Health Connect below',
                  'Go to App permissions › POWR',
                  'Allow read access for Steps, Workouts and Sleep',
                ]
          }
          buttonLabel={isIOS ? 'Open Apple Health' : 'Open Health Connect'}
          onPress={isIOS ? openAppleHealth : () => androidOpenHealthConnectSettings()}
        />

        <Text style={styles.footer}>
          Changed a setting? Return here and the status above will update. Still stuck? Use the Help
          Centre to contact us.
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
  const meta = STATUS_META[status];
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name={icon} size={18} color={DIM} style={styles.cardIcon} />
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={[styles.statusPill, { borderColor: meta.color }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
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
