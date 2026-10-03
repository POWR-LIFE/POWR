import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useState } from 'react';
import {
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GarminViaPhoneSheet from '@/components/GarminViaPhoneSheet';
import GeometricBackground from '@/components/GeometricBackground';
import { androidCheckAlreadyGranted, androidOpenHealthConnectSettings } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { getNativeProviderId, HealthProviderNotImplementedError, type HealthProviderId } from '@/lib/health/providers';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const BG     = '#0d0d0d';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';

// ─── Logo map (same bucket as onboarding) ─────────────────────────────────────

const BASE = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos';
const BRAND_LOGOS: Partial<Record<HealthProviderId, string>> = {
  'apple-health':   `${BASE}/apple.png`,
  'fitbit':         `${BASE}/fitbit.png`,
  'garmin':         `${BASE}/garmin.png`,
  'whoop':          `${BASE}/whoop.png`,
  'polar':          `${BASE}/polar-logo.svg`,
  'oura':           `${BASE}/oura_logo.png`,
  'huawei':         `${BASE}/huawei-Logo.png`,
  'samsung-health': `${BASE}/samsung-health-logo.png`,
  'strava':         `${BASE}/strava-logo.png`,
  'withings':       `${BASE}/withings-logo.png`,
  'zepp':           `${BASE}/zepp-logo.png`,
  'technogym':      `${BASE}/technogym-logo.png`,
  'coros':          `${BASE}/coros-logo.png`,
  'suunto':         `${BASE}/suunto-logo.png`,
  'wahoo':          `${BASE}/wahoo-logo.jpeg`,
  'zwift':          `${BASE}/zwift-logo.png`,
  'concept2':       `${BASE}/concept-two.png`,
  'ifit':           `${BASE}/ifit-logo.png`,
  'underarmour':    `${BASE}/under-armour-logo.png`,
  'peloton':        `${BASE}/pelaton-logo.png`,
};

// ─── Grid sizing ──────────────────────────────────────────────────────────────

const GRID_GAP = 8;
const GRID_PAD = 16;
const CARD_W = Math.floor((Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3);

// ─── Logo component ───────────────────────────────────────────────────────────

function BrandIcon({ id, size = 24 }: { id: HealthProviderId; size?: number }) {
  const logoUrl = BRAND_LOGOS[id];
  if (logoUrl) {
    return (
      <Image
        source={{ uri: logoUrl }}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    );
  }
  switch (id) {
    case 'health-connect':
      return <MaterialCommunityIcons name="heart-pulse" size={size} color="#fff" />;
    case 'samsung-health':
      return <MaterialCommunityIcons name="heart" size={size} color="#fff" />;
    case 'strava':
      return <MaterialCommunityIcons name="run" size={size} color="#fff" />;
    default:
      return <MaterialCommunityIcons name="watch-variant" size={size} color="#fff" />;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WearablesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const providers = useHealthProviders();

  useFocusEffect(
    useCallback(() => { providers.refresh(); }, [providers.refresh]),
  );

  const wearableRows = providers.rows.filter(r => !r.meta.native);
  const connectedWearable = wearableRows.find(r => !!r.connection);

  // Garmin's direct link is paused — its tile opens the sync-through-the-phone
  // sheet instead of connecting.
  const [showGarminSheet, setShowGarminSheet] = useState(false);
  const [androidGranted, setAndroidGranted] = useState(false);
  const nativeId = getNativeProviderId();
  // Android reports the live Health Connect grant silently, so a permission
  // revoked in system settings brings the connect button back. HealthKit hides
  // read access entirely (and asking would prompt), so iOS uses the profile's
  // connection record.
  const phoneConnected = Platform.OS === 'android'
    ? androidGranted
    : !!providers.rows.find(r => r.meta.native)?.connection;

  function openGarminSheet() {
    setShowGarminSheet(true);
    if (Platform.OS === 'android') {
      androidCheckAlreadyGranted().then(setAndroidGranted).catch(() => setAndroidGranted(false));
    }
  }
  const phoneStore = Platform.OS === 'android' ? 'Health Connect' : Platform.OS === 'ios' ? 'Apple Health' : 'your phone';

  function connectPhone() {
    if (!nativeId) return;
    (async () => {
      const result = await providers.connect(nativeId);
      if (result !== 'failed') {
        if (Platform.OS === 'android') setAndroidGranted(true);
        return;
      }
      if (Platform.OS === 'android') {
        Alert.alert(
          'Health Connect not connected',
          'Permission was not granted. You can allow it in Health Connect settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Health Connect', onPress: androidOpenHealthConnectSettings },
          ],
        );
      } else {
        Alert.alert('Apple Health not connected', 'We could not start the connection. Please try again.');
      }
    })();
  }

  function doConnect(id: HealthProviderId, name: string) {
    (async () => {
      try {
        await SecureStore.setItemAsync('oauth.returnTo', 'settings');
        const result = await providers.connect(id);
        if (result === 'failed') {
          Alert.alert(`${name} not connected`, 'We could not start the connection. Please try again.');
        }
      } catch (e) {
        if (e instanceof HealthProviderNotImplementedError) {
          Alert.alert(`${name} coming soon`, 'This integration is not available yet.');
        } else {
          Alert.alert('Connection failed', String((e as Error).message ?? e));
        }
      }
    })();
  }

  function handleCardPress(id: HealthProviderId, name: string) {
    const row = wearableRows.find(r => r.meta.id === id);
    if (!row) return;
    if (row.meta.paused) {
      openGarminSheet();
      return;
    }
    const connected = !!row.connection;
    if (providers.busyId) return;

    if (connected) {
      // Only action on the connected device is to disconnect
      Alert.alert(
        `Disconnect ${name}?`,
        'POWR will stop reading from this device and clear stored credentials.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Disconnect', style: 'destructive', onPress: () => { providers.disconnect(id); } },
        ],
      );
      return;
    }

    // Not connected — if another device is already connected, warn first
    if (connectedWearable) {
      Alert.alert(
        `Switch to ${name}?`,
        `You can only connect one device at a time. This will disconnect ${connectedWearable.meta.name}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Switch to ${name}`, onPress: () => doConnect(id, name) },
        ],
      );
      return;
    }

    doConnect(id, name);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Wearables</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hint}>
          Connect one device to verify workouts and earn bonus points. You can switch at any time — only one can be active.
        </Text>

        <View style={styles.grid}>
          {wearableRows.map(row => {
            const connected = !!row.connection;
            const busy = providers.busyId === row.meta.id;
            const id = row.meta.id;
            const logoUrl = BRAND_LOGOS[id];
            return (
              <Pressable
                key={id}
                style={({ pressed }) => [
                  styles.card,
                  connected && styles.cardConnected,
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => handleCardPress(id, row.meta.name)}
                disabled={busy}
              >
                <View style={[
                  styles.logoWrap,
                  logoUrl && styles.logoWrapWhite,
                  connected && styles.logoWrapGlow,
                ]}>
                  <BrandIcon id={id} size={Math.round(CARD_W * 0.44)} />
                </View>
                <Text style={styles.cardName} numberOfLines={1}>{row.meta.name}</Text>
                {row.meta.paused && (
                  <Text style={styles.cardVia} numberOfLines={1}>VIA {phoneStore.toUpperCase()}</Text>
                )}
                {connected && (
                  <View style={styles.checkBadge}>
                    <MaterialCommunityIcons name="check" size={10} color="#000" />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footerNote}>
          More devices sync automatically via Apple Health or Health Connect — connect those from the health sources section in Settings.
        </Text>
      </ScrollView>

      <GarminViaPhoneSheet
        visible={showGarminSheet}
        phoneConnected={phoneConnected}
        busy={!!nativeId && providers.busyId === nativeId}
        onConnectPhone={connectPhone}
        onClose={() => setShowGarminSheet(false)}
      />
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
    backgroundColor: 'rgba(40,40,40,0.85)',
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
  content: {
    paddingHorizontal: GRID_PAD,
    paddingTop: 12,
    gap: 16,
  },

  hint: {
    fontSize: 13,
    fontWeight: '300',
    color: MUTED,
    lineHeight: 19,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },

  card: {
    width: CARD_W,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 16,
    gap: 8,
  },
  cardConnected: {
    backgroundColor: 'transparent',
  },

  logoWrap: {
    width: CARD_W * 0.56,
    height: CARD_W * 0.56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  logoWrapWhite: {
    backgroundColor: '#FFFFFF',
  },
  logoWrapGlow: {
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },

  cardName: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
    paddingHorizontal: 4,
  },

  cardVia: {
    color: MUTED,
    fontSize: 7,
    fontWeight: '500',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: -5,
  },

  checkBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footerNote: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.2)',
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
