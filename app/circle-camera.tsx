import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
import { circleToPhotoCrop, settleCirclePhoto } from '@/lib/circlePhoto';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const BORDER = '#222222';
const DIM = 'rgba(0,0,0,0.6)';

/** Circle diameter as a fraction of the preview width. */
const CIRCLE_FRACTION = 0.78;
/** Circle centre as a fraction of the preview height — a touch above centre so the controls don't crowd it. */
const CIRCLE_CENTRE_Y = 0.42;

/**
 * Circular viewfinder for the share-card "My Photo" circle. What the user
 * sees inside the ring is exactly what lands on the card: on capture we map
 * the ring onto the photo and hand back a crop rect (see lib/circlePhoto).
 */
export default function CircleCameraScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ width: number; height: number } | null>(null);
  const camera = useRef<CameraView>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Swipe-to-dismiss or a back gesture never reaches `close` — settle on unmount.
  useEffect(() => () => {
    if (!settled.current) settleCirclePhoto(null);
  }, []);

  const finish = (photo: Parameters<typeof settleCirclePhoto>[0]) => {
    settled.current = true;
    settleCirclePhoto(photo);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const close = () => finish(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setView({ width, height });
  };

  async function capture() {
    if (!camera.current || !view || busy || !ready) return;
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const shot = await camera.current.takePictureAsync({ quality: 0.9 });
      if (!shot) { setBusy(false); return; }
      // The app is portrait-locked, so the photo displays portrait whatever the
      // sensor reports. Only the aspect matters for the mapping.
      const [width, height] = shot.width > shot.height ? [shot.height, shot.width] : [shot.width, shot.height];
      const diameter = view.width * CIRCLE_FRACTION;
      const crop = circleToPhotoCrop(
        view,
        { cx: view.width / 2, cy: view.height * CIRCLE_CENTRE_Y, diameter },
        { width, height },
      );
      finish({ uri: shot.uri, width, height, crop });
    } catch (e) {
      console.warn('[CircleCamera] capture failed:', e);
      setBusy(false);
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <Pressable onPress={close} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
        <Ionicons name="close" size={26} color={TEXT} />
      </Pressable>
      <Text style={styles.headerTitle}>MY PHOTO</Text>
      <View style={styles.headerBtn} />
    </View>
  );

  if (!permission) {
    return <View style={styles.screen}>{header}</View>;
  }

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
            POWR needs your camera to take a photo for your card. You can enable it in Settings, or pick one from your library instead.
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
          <Pressable style={styles.ghostBtn} onPress={close}>
            <Text style={styles.ghostBtnText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const diameter = view ? view.width * CIRCLE_FRACTION : 0;
  // A ring whose border is thick enough to cover the whole screen: the border
  // is the dimmed area, the hole is the live circle. No mask view needed.
  const ringBorder = view ? Math.max(view.width, view.height) : 0;

  return (
    <View style={styles.screen}>
      <View style={styles.preview} onLayout={onLayout}>
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mirror
          animateShutter={false}
          onCameraReady={() => setReady(true)}
        />
        {view && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View
              style={{
                position: 'absolute',
                left: view.width / 2 - diameter / 2 - ringBorder,
                top: view.height * CIRCLE_CENTRE_Y - diameter / 2 - ringBorder,
                width: diameter + ringBorder * 2,
                height: diameter + ringBorder * 2,
                borderRadius: diameter / 2 + ringBorder,
                borderWidth: ringBorder,
                borderColor: DIM,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: view.width / 2 - diameter / 2,
                top: view.height * CIRCLE_CENTRE_Y - diameter / 2,
                width: diameter,
                height: diameter,
                borderRadius: diameter / 2,
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.7)',
              }}
            />
            <Text style={[styles.hint, { top: view.height * CIRCLE_CENTRE_Y + diameter / 2 + 20 }]}>
              What’s inside the circle goes on your card
            </Text>
          </View>
        )}
      </View>

      <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
        {header}
        <View style={[styles.controls, { paddingBottom: insets.bottom + 28 }]}>
          <View style={styles.sideBtn} />
          <Pressable
            onPress={capture}
            disabled={busy || !ready}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            style={({ pressed }) => [styles.shutter, (pressed || busy) && { opacity: 0.6 }]}
          >
            <View style={styles.shutterInner}>
              {busy && <ActivityIndicator color="#0a0a0a" />}
            </View>
          </Pressable>
          <Pressable
            onPress={() => setFacing(f => (f === 'front' ? 'back' : 'front'))}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Flip camera"
            style={({ pressed }) => [styles.sideBtn, styles.flipBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="camera-reverse-outline" size={24} color={TEXT} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { justifyContent: 'space-between' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerTitle: { fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT, textAlign: 'center' },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  hint: { position: 'absolute', left: 32, right: 32, fontFamily: fontFamily.medium, fontSize: 13, color: TEXT, textAlign: 'center', opacity: 0.85 },

  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 40 },
  sideBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  flipBtn: { borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },

  deniedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  deniedIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  deniedTitle: { fontFamily: fontFamily.semiBold, fontSize: 18, color: TEXT, textAlign: 'center' },
  deniedSub: { fontFamily: fontFamily.regular, fontSize: 14, color: SECONDARY, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  primaryBtn: { backgroundColor: GOLD, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28 },
  primaryBtnText: { fontFamily: fontFamily.semiBold, fontSize: 14, color: '#0a0a0a' },
  ghostBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  ghostBtnText: { fontFamily: fontFamily.medium, fontSize: 14, color: SECONDARY },
});
