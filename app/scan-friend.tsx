import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
import { parseReferralCode } from '@/lib/social/friendCode';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const BORDER = '#222222';

export default function ScanFriendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState<string | null>(null);
  // Guards onBarcodeScanned, which otherwise fires continuously per frame.
  const locked = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask once on mount if we don't already have a decision.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const onScan = ({ data }: { data: string }) => {
    if (locked.current) return;
    const code = parseReferralCode(data);
    if (!code) {
      // Re-arm after a beat so a stray QR (Wi-Fi, a random URL) doesn't dead-end.
      if (!hint) {
        setHint("That's not a POWR code — try their code again.");
        hintTimer.current = setTimeout(() => setHint(null), 2200);
      }
      return;
    }
    locked.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace(`/add-friend?ref=${code}`);
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/friends');
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <Text style={styles.headerTitle}>SCAN A CODE</Text>
      <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
        <Ionicons name="close" size={24} color={TEXT} />
      </Pressable>
    </View>
  );

  // Permission still resolving.
  if (!permission) {
    return <View style={styles.screen}>{header}</View>;
  }

  // Permission denied — explain and offer the username fallback.
  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.deniedBody}>
          <View style={styles.deniedIcon}>
            <Ionicons name="camera-outline" size={30} color={MUTED} />
          </View>
          <Text style={styles.deniedTitle}>Camera access needed</Text>
          <Text style={styles.deniedSub}>
            POWR needs your camera to scan a friend’s code. You can enable it in Settings, or add friends by username instead.
          </Text>
          {permission.canAskAgain ? (
            <Pressable style={styles.primaryBtn} onPress={requestPermission}>
              <Text style={styles.primaryBtnText}>Allow camera</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.primaryBtn} onPress={() => Linking.openSettings()}>
              <Text style={styles.primaryBtnText}>Open settings</Text>
            </Pressable>
          )}
          <Pressable style={styles.ghostBtn} onPress={() => router.replace('/friends')}>
            <Text style={styles.ghostBtnText}>Add by username</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Granted — live scanner.
  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScan}
      />
      <View style={styles.overlay}>
        {header}
        <View style={styles.reticleWrap}>
          <View style={styles.reticle} />
          <Text style={styles.scanHint}>{hint ?? 'Point at a friend’s POWR code'}</Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 24 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  headerTitle: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT, marginLeft: 40, textAlign: 'center' },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  reticleWrap: { alignItems: 'center', gap: 20 },
  reticle: { width: 240, height: 240, borderRadius: 28, borderWidth: 2, borderColor: GOLD, backgroundColor: 'transparent' },
  scanHint: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT, textAlign: 'center', paddingHorizontal: 32 },

  deniedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  deniedIcon: { width: 60, height: 60, borderRadius: 30, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  deniedTitle: { fontFamily: fontFamily.medium, fontSize: 18, color: TEXT },
  deniedSub: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center', lineHeight: 20 },
  primaryBtn: { marginTop: 12, backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 32, height: 50, minWidth: 200, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontFamily: fontFamily.bold, fontSize: 15, color: '#0a0a0a' },
  ghostBtn: { paddingHorizontal: 28, height: 46, borderRadius: 100, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT },
});
