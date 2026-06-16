import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { ShareCard } from '@/components/share/ShareCard';
import { fetchAutoSummary, fetchChallengeSummary, fetchCheckInSummary, type ShareSummary } from '@/lib/api/share';

const GOLD  = '#E8D200';
const BG    = '#0d0d0d';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.25)';

const POWR_LOGO_URI = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext.png';

type Mode   = 'check-in' | 'streak' | 'challenge';
type BgMode = 'cover' | 'powr' | 'gallery';

const BG_OPTIONS: { key: BgMode; icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { key: 'cover',   icon: 'person-circle-outline', label: 'My Photo'  },
  { key: 'powr',    icon: 'flash',                 label: 'POWR'      },
  { key: 'gallery', icon: 'images-outline',        label: 'Gallery'   },
];

export default function ShareStatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; sessionId?: string; challenge?: string }>();
  const mode: Mode =
    params.mode === 'check-in' ? 'check-in' : params.mode === 'challenge' ? 'challenge' : 'streak';

  const cardRef = useRef<View>(null);
  const [summary, setSummary]     = useState<ShareSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sharing, setSharing]     = useState(false);
  const [bgMode, setBgMode]       = useState<BgMode>('cover');
  const [galleryUri, setGalleryUri] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'check-in') {
      if (!params.sessionId) { setLoadError('No session specified.'); return; }
      fetchCheckInSummary(params.sessionId)
        .then(setSummary)
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load this check-in.'));
    } else if (mode === 'challenge') {
      if (!params.challenge) { setLoadError('No challenge specified.'); return; }
      let challenge;
      try {
        challenge = JSON.parse(params.challenge);
      } catch {
        setLoadError('Could not load this challenge.');
        return;
      }
      fetchChallengeSummary(challenge)
        .then(setSummary)
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load this challenge.'));
    } else {
      fetchAutoSummary()
        .then(setSummary)
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load your stats.'));
    }
  }, [mode, params.sessionId, params.challenge]);

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setLoadError('Photo library access is required to use your own photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [9, 16],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setGalleryUri(result.assets[0].uri);
      setBgMode('gallery');
    }
  }

  function handleBgOption(key: BgMode) {
    if (key === 'gallery') {
      pickFromGallery();
    } else {
      setBgMode(key);
    }
  }

  function effectiveBgSource(): string | number | null | undefined {
    if (bgMode === 'gallery') return galleryUri ?? undefined;
    if (bgMode === 'powr')    return null;   // solid dark
    return null;                             // cover → solid dark + circular avatar overlay
  }

  function effectiveAvatarUri(): string | null {
    if (bgMode === 'cover') return summary?.profile.avatarUrl ?? null;
    return null;
  }

  function effectiveTopImage(): string | null {
    if (bgMode === 'powr') return POWR_LOGO_URI;
    return null;
  }

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Reserve space for header (~52) + picker row (~56) + footer (~94) + gaps (~38)
  const NON_CARD_HEIGHT = 240;
  const maxCardHeight = windowHeight - insets.top - insets.bottom - NON_CARD_HEIGHT;
  const maxWidthFromHeight = maxCardHeight * (9 / 16);
  const previewWidth = Math.min(windowWidth - 48, 360, maxWidthFromHeight);

  async function handleShare() {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
      const available = await Sharing.isAvailableAsync();
      if (!available) { setLoadError('Sharing is not available on this device.'); return; }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle:
          mode === 'check-in' ? 'Share your check-in'
          : mode === 'challenge' ? 'Share your challenge'
          : 'Share your streak',
        UTI: 'public.png',
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not share image.');
    } finally {
      setSharing(false);
    }
  }

  const headerTitle =
    mode === 'check-in' ? 'Share check-in'
    : mode === 'challenge' ? 'Share challenge'
    : 'Share your streak';

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Card preview */}
      <View style={styles.body}>
        {!summary && !loadError && <ActivityIndicator color={GOLD} />}
        {loadError && <Text style={styles.errorText}>{loadError}</Text>}
        {summary && (
          <ShareCard
            ref={cardRef}
            summary={summary}
            width={previewWidth}
            backgroundSource={effectiveBgSource()}
            avatarUri={effectiveAvatarUri()}
            topImage={effectiveTopImage()}
            hideLogo={bgMode === 'powr'}
          />
        )}
      </View>

      {/* Background picker */}
      {summary && (
        <View style={styles.pickerRow}>
          {BG_OPTIONS.map(opt => {
              const isGalleryWithImage = opt.key === 'gallery' && galleryUri !== null;
            const isActive = opt.key === bgMode;
            return (
              <Pressable
                key={opt.key}
                onPress={() => handleBgOption(opt.key)}
                style={({ pressed }) => [
                  styles.pickerOption,
                  isActive && styles.pickerOptionActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={isGalleryWithImage ? 'checkmark-circle' : opt.icon}
                  size={16}
                  color={isActive ? GOLD : DIM}
                />
                <Text style={[styles.pickerLabel, isActive && styles.pickerLabelActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Share button */}
      {summary && (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.shareBtn, (pressed || sharing) && { opacity: 0.85 }]}
            onPress={handleShare}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color="#0a0a0a" />
                <Text style={styles.shareBtnText}>Share to Socials</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.helperText}>
            Posts as a 1080×1920 image — works for Instagram, Facebook, TikTok and X.
          </Text>
        </View>
      )}
    </View>
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
    paddingVertical: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '300',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  pickerOptionActive: {
    borderColor: GOLD,
    backgroundColor: 'rgba(232,210,0,0.08)',
  },
  pickerLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: DIM,
  },
  pickerLabelActive: {
    color: GOLD,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 4,
    gap: 12,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 20,
    paddingVertical: 14,
  },
  shareBtnText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },
  helperText: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
    lineHeight: 16,
  },
});
