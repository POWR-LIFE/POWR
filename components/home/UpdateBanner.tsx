import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import {
  checkForUpdate,
  dismissBannerFor,
  isBannerDismissedFor,
  openStorePage,
} from '@/lib/appUpdate';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const BORDER = '#222222';
const CARD_BG = '#111111';

// "A newer store build exists" nudge at the top of Home. Renders nothing while
// up to date, so Home just mounts it unconditionally. Dismissal sticks per
// target version — it returns only when the NEXT release goes out.
export function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { updateAvailable, latest } = await checkForUpdate();
      if (cancelled || !updateAvailable || !latest) return;
      if (await isBannerDismissedFor(latest)) return;
      if (!cancelled) setLatest(latest);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    dismissBannerFor(latest);
  };

  return (
    <View style={styles.card} testID="update-banner">
      <View style={styles.iconWrap}>
        <Ionicons name="arrow-up-circle" size={20} color={GOLD} />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.title}>Update available</Text>
        <Text style={styles.body}>POWR v{latest} is out — get the latest fixes and features.</Text>
      </View>
      <Pressable style={styles.cta} onPress={openStorePage} testID="update-banner-cta">
        <Text style={styles.ctaText}>Update</Text>
      </Pressable>
      <Pressable style={styles.close} onPress={dismiss} hitSlop={8} testID="update-banner-dismiss">
        <Ionicons name="close" size={16} color={SECONDARY} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    marginBottom: 12,
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(232,210,0,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: { flex: 1 },
  title: { color: TEXT, fontSize: 13, fontFamily: fontFamily.semiBold },
  body: { color: SECONDARY, fontSize: 11.5, fontFamily: fontFamily.regular, marginTop: 1 },
  cta: {
    backgroundColor: GOLD,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  ctaText: { color: '#080808', fontSize: 12, fontFamily: fontFamily.semiBold },
  close: { padding: 6 },
});
