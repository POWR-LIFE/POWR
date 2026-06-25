import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { Avatar } from '@/components/social/Avatar';
import { fontFamily } from '@/constants/tokens';
import { fetchProfile, type Profile } from '@/lib/api/user';
import type { Friend } from '@/lib/social/types';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const CARD_BG = '#141414';
const BORDER = '#222222';

/** The QR encodes the smart-link so a non-user who scans it lands on the store. */
function friendLink(referralCode: string): string {
  return `https://powr.life/app?to=add-friend&ref=${referralCode}`;
}

export default function MyQrScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetchProfile().then((p) => {
      if (active) {
        setProfile(p);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const code = profile?.referral_code ?? null;
  const link = code ? friendLink(code) : null;

  const me: Friend | null = profile
    ? {
        id: profile.id,
        username: profile.username ?? '',
        displayName: profile.display_name ?? profile.username ?? 'You',
        avatarUrl: profile.avatar_url,
        status: 'accepted',
      }
    : null;

  const handleShare = async () => {
    if (!link) return;
    Haptics.selectionAsync();
    try {
      await Share.share({
        message: `Add me on POWR 💪\n${link}`,
        url: link,
      });
    } catch {
      // user dismissed — no-op
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>MY CODE</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={SECONDARY} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={GOLD} />
        ) : !code || !me ? (
          <Text style={styles.errorLine}>Couldn’t load your code. Try again in a moment.</Text>
        ) : (
          <>
            <View style={styles.identity}>
              <Avatar friend={me} size={64} />
              <Text style={styles.name}>{me.displayName}</Text>
              {me.username ? <Text style={styles.handle}>@{me.username}</Text> : null}
            </View>

            <View style={styles.qrCard}>
              <QRCode value={link!} size={232} color="#0a0a0a" backgroundColor="#FFFFFF" />
            </View>

            <Text style={styles.caption}>
              Have a friend scan this to connect on POWR — then you can take on challenges together.
            </Text>

            <View style={styles.actions}>
              <Pressable style={styles.shareBtn} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share your code">
                <Ionicons name="share-outline" size={16} color="#0a0a0a" />
                <Text style={styles.shareBtnText}>Share link</Text>
              </Pressable>
              <Pressable style={styles.copyBtn} onPress={handleCopy} accessibilityRole="button" accessibilityLabel="Copy link">
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? GOLD : SECONDARY} />
                <Text style={[styles.copyBtnText, copied && { color: GOLD }]}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>

            <Pressable style={styles.scanLink} onPress={() => router.push('/scan-friend')} accessibilityRole="button" accessibilityLabel="Scan a friend's code">
              <Ionicons name="scan-outline" size={16} color={SECONDARY} />
              <Text style={styles.scanLinkText}>Scan a friend’s code instead</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  errorLine: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center' },

  identity: { alignItems: 'center', gap: 8 },
  name: { fontFamily: fontFamily.medium, fontSize: 18, color: TEXT },
  handle: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, marginTop: -4 },

  qrCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20 },
  caption: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, textAlign: 'center', lineHeight: 19, maxWidth: 300 },

  actions: { flexDirection: 'row', gap: 12 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 22, paddingVertical: 12,
  },
  shareBtnText: { fontFamily: fontFamily.bold, fontSize: 13, color: '#0a0a0a' },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 22, paddingVertical: 12,
  },
  copyBtnText: { fontFamily: fontFamily.medium, fontSize: 13, color: SECONDARY },

  scanLink: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
  scanLinkText: { fontFamily: fontFamily.medium, fontSize: 13, color: SECONDARY },
});
