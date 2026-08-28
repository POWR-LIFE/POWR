import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { fontFamily } from '@/constants/tokens';
import { eventInviteLink, eventInviteMessage } from '@/lib/eventInviteLink';
import { fetchProfile } from '@/lib/api/user';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * Per-event registration QR — the in-app twin of the admin panel's download.
 * Same link contract (lib/eventInviteLink), plus the viewer's ref code so an
 * invite scanned off this screen still attributes to them.
 */
export default function EventQrScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug, name } = useLocalSearchParams<{ slug?: string; name?: string }>();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetchProfile().then((p) => {
      if (active) {
        setCode(p?.referral_code ?? null);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const eventSlug = typeof slug === 'string' ? slug : null;
  const link = eventSlug ? eventInviteLink(eventSlug, code) : null;
  const eventName = typeof name === 'string' && name ? name : 'the event';
  const message = link ? eventInviteMessage({ eventName, link, code }) : null;

  const handleShare = async () => {
    if (!link || !message) return;
    Haptics.selectionAsync();
    try {
      await Share.share({ message, url: link });
    } catch {
      // user dismissed — no-op
    }
  };

  // Code + link, same text as Share — a bare link loses the code at the store.
  const handleCopy = async () => {
    if (!message) return;
    await Clipboard.setStringAsync(message);
    Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>EVENT INVITE</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={SECONDARY} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={GOLD} />
        ) : !link ? (
          <Text style={styles.errorLine}>Couldn’t load the event link. Try again in a moment.</Text>
        ) : (
          <>
            <View style={styles.identity}>
              <Text style={styles.eyebrow}>LIVE EVENT</Text>
              <Text style={styles.name}>{eventName}</Text>
            </View>

            <View style={styles.qrCard}>
              <QRCode value={link} size={232} color="#0a0a0a" backgroundColor="#FFFFFF" />
            </View>

            <Text style={styles.caption}>
              Scanning this opens {eventName} in POWR{code ? ` — invites count towards your code ${code}` : ''}.
            </Text>

            <View style={styles.actions}>
              <Pressable style={styles.shareBtn} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share the event link">
                <Ionicons name="share-outline" size={16} color="#0a0a0a" />
                <Text style={styles.shareBtnText}>Share link</Text>
              </Pressable>
              <Pressable style={styles.copyBtn} onPress={handleCopy} accessibilityRole="button" accessibilityLabel="Copy the invite code and link">
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? GOLD : SECONDARY} />
                <Text style={[styles.copyBtnText, copied && { color: GOLD }]}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>

            {/* Same invite, as an image — for Stories and anyone who'd rather
                post a picture than a link. */}
            <Pressable
              style={({ pressed }) => [styles.cardLink, pressed && { opacity: 0.7 }]}
              onPress={() => {
                Haptics.selectionAsync();
                router.push({ pathname: '/share-event', params: { slug: eventSlug } });
              }}
              accessibilityRole="button"
              accessibilityLabel="Share the event as a card"
            >
              <Ionicons name="image-outline" size={15} color={GOLD} />
              <Text style={styles.cardLinkText}>Share as a card</Text>
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

  identity: { alignItems: 'center', gap: 6 },
  eyebrow: { fontFamily: fontFamily.bold, fontSize: 9, letterSpacing: 2.5, color: GOLD, opacity: 0.7 },
  name: { fontFamily: fontFamily.light, fontSize: 22, color: TEXT, textAlign: 'center', maxWidth: 320 },

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

  cardLink: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12 },
  cardLinkText: { fontFamily: fontFamily.medium, fontSize: 13, color: GOLD },
});
