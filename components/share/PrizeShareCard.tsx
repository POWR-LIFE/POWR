import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { rankLabel } from '@/components/events/EventPrizeList';
import { fontFamily } from '@/constants/tokens';
import type { LiveEventPrize } from '@/lib/api/liveEvents';
import { eventDateRange } from '@/lib/liveEventDisplay';
import type { PrizeShareEvent } from '@/lib/prizeShare';
import { prizeArtUri } from '@/lib/storageImage';

/**
 * Chat clients centre-crop a 9:16 image to roughly 3:4 in the bubble, taking
 * ~12.5% off the top and bottom. The wordmark, the label and the code all
 * live inside that band. Same constant as ShareCard, for the same reason.
 */
const CROP_SAFE_Y = 250;

const GOLD  = '#E8D200';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.32)';

/** Prize posters are portrait (2:3) in practice; the frame starts there and
 *  re-cuts itself to the real picture the moment expo-image reports it. */
const DEFAULT_ASPECT = 2 / 3;

interface PrizeShareCardProps extends ViewProps {
  event: PrizeShareEvent;
  prize: LiveEventPrize;
  /** The sharer's code, spelled out on the card — the only part of an invite
   *  that survives Instagram/TikTok stripping the caption. Null hides the row. */
  referralCode: string | null;
  /** Width in dp the card renders at. Height is derived 9:16. */
  width: number;
  /** Fires once the artwork has loaded (or there is none to wait for). */
  onReady?: () => void;
}

/**
 * The prize as a social card — what a member sends when they want a friend to
 * see what's on the line at an event.
 *
 * The poster IS the card: it sits contained inside a gold-hairline frame on a
 * dark, blurred echo of itself, never cropped (the artwork carries its own
 * composition and the viewer already promised not to cut it). Above it the
 * POWR wordmark and the ordinal; beneath it the prize label, the event and its
 * week, then the sharer's code and the POWR.LIFE mark — because Stories strip
 * the caption, the image has to carry the whole invite on its own.
 *
 * Rendered off-screen at 720×1280 / 1080×1920 and captured with
 * react-native-view-shot, exactly like ShareCard and RewardShareCard.
 */
export const PrizeShareCard = forwardRef<View, PrizeShareCardProps>(
  ({ event, prize, referralCode, width, onReady, style, ...rest }, ref) => {
    const height = (width * 16) / 9;
    // Scale tokens proportionally to width — base sizes designed for 1080dp.
    const s = width / 1080;

    // The 1080 spec is what the gallery card and the spotlight already loaded,
    // so the share preview is a cache hit rather than a fresh fetch.
    const artUri = prizeArtUri(prize.image_url);
    const [aspect, setAspect] = useState(DEFAULT_ASPECT);
    // The bottom block's real height (it grows with a two-line label), so the
    // poster slot ends where the text begins instead of guessing and
    // colliding. Measured on first layout — before any image lands.
    const [bodyH, setBodyH] = useState(600 * s);

    // Readiness: the framed artwork and its blurred echo are two Image
    // instances of one URI. Both must paint before a capture is honest.
    const remaining = useRef(artUri ? 2 : 0);
    const notified = useRef(false);
    const imageDone = () => {
      remaining.current -= 1;
      if (remaining.current <= 0 && !notified.current) {
        notified.current = true;
        onReady?.();
      }
    };
    useEffect(() => {
      if (remaining.current === 0 && !notified.current) {
        notified.current = true;
        onReady?.();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The frame: as wide as the gutters allow, as tall as the space between
    // the header and the bottom block, cut to the picture's own aspect.
    const slotTop = 420;
    const slotBottom = bodyH / s + 40;
    const maxW = 1080 - 2 * 110;
    // An imageless prize shows its rank as a monogram: a square tile, and a
    // smaller one — a number doesn't need a poster's worth of frame.
    const maxH = Math.min(artUri ? 840 : 600, 1920 - slotTop - slotBottom);
    const frameAspect = artUri ? aspect : 1;
    let frameH = Math.min(maxH, maxW / frameAspect);
    let frameW = frameH * frameAspect;
    if (frameW > maxW) { frameW = maxW; frameH = frameW / frameAspect; }

    return (
      <View ref={ref} collapsable={false} style={[styles.root, { width, height }, style]} {...rest}>
        {/* Ground: a dark, heavily blurred echo of the poster so the card
            inherits the artwork's palette instead of sitting on flat black. */}
        {artUri ? (
          <Image
            source={{ uri: artUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            blurRadius={40}
            transition={0}
            cachePolicy="memory-disk"
            onLoad={imageDone}
            onError={imageDone}
          />
        ) : null}
        <LinearGradient
          colors={['rgba(13,13,13,0.88)', 'rgba(13,13,13,0.78)', 'rgba(13,13,13,0.96)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* ── Header ──────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingHorizontal: 60 * s, paddingTop: CROP_SAFE_Y * s }]}>
          <Image
            source={require('@/assets/images/powrlogotext.png')}
            style={{ width: 400 * s, height: 120 * s, marginLeft: -50 * s }}
            contentFit="contain"
            transition={0}
          />
          <View style={{ flex: 1 }} />
          <View style={[styles.rankPill, { paddingHorizontal: 26 * s, paddingVertical: 14 * s, borderRadius: 100 * s }]}>
            <Text style={[styles.rankPillText, { fontSize: 24 * s, letterSpacing: 4 * s }]}>
              {`${rankLabel(prize.rank)} PRIZE`}
            </Text>
          </View>
        </View>

        {/* ── The poster ──────────────────────────────────────────── */}
        <View style={[StyleSheet.absoluteFillObject, styles.centreSlot, { paddingTop: slotTop * s, paddingBottom: slotBottom * s }]} pointerEvents="none">
          <View
            style={[
              styles.frame,
              {
                width: frameW * s,
                height: frameH * s,
                borderRadius: 36 * s,
                borderWidth: Math.max(1, 2 * s),
              },
            ]}
          >
            {artUri ? (
              <Image
                source={{ uri: artUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="contain"
                transition={0}
                cachePolicy="memory-disk"
                accessibilityIgnoresInvertColors
                onLoad={(e) => {
                  const { width: w, height: h } = e.source;
                  if (w > 0 && h > 0) setAspect(w / h);
                  imageDone();
                }}
                onError={imageDone}
              />
            ) : (
              <Text style={[styles.monogram, { fontSize: 360 * s, letterSpacing: -12 * s }]}>{prize.rank}</Text>
            )}
          </View>
        </View>

        {/* ── Body (pinned to bottom) ─────────────────────────────── */}
        <View
          style={[styles.body, { paddingHorizontal: 60 * s, paddingBottom: CROP_SAFE_Y * s }]}
          onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}
        >
          <Text style={[styles.label, { fontSize: 58 * s, lineHeight: 66 * s, letterSpacing: -0.5 * s }]} numberOfLines={2}>
            {prize.label}
          </Text>
          <Text style={[styles.eventLine, { fontSize: 30 * s, marginTop: 16 * s }]} numberOfLines={1}>
            {`${event.name} · ${eventDateRange(event)}`}
          </Text>

          <View style={[styles.divider, { marginTop: 48 * s, marginBottom: 40 * s }]} />

          {referralCode ? (
            <View style={styles.codeRow}>
              <Text style={[styles.codeLabel, { fontSize: 22 * s, letterSpacing: 4 * s }]}>
                JOIN ME WITH CODE
              </Text>
              <Text style={[styles.code, { fontSize: 44 * s, letterSpacing: 6 * s, marginLeft: 28 * s }]}>
                {referralCode}
              </Text>
            </View>
          ) : (
            <Text style={[styles.codeLabel, { fontSize: 22 * s, letterSpacing: 4 * s }]}>
              JOIN ME ON POWR
            </Text>
          )}

          {/* Instagram/TikTok strip share-sheet text, so the image itself must
              carry where to find us. */}
          <Text style={[styles.footerUrl, { fontSize: 24 * s, letterSpacing: 7 * s, marginTop: 44 * s }]}>
            POWR.LIFE
          </Text>
        </View>
      </View>
    );
  },
);
PrizeShareCard.displayName = 'PrizeShareCard';

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
    position: 'relative',
  },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
  },
  // Solid gold, black type — the one chip that reads on any artwork, same
  // as the gallery card's.
  rankPill: { backgroundColor: GOLD },
  rankPillText: { fontFamily: fontFamily.bold, color: '#0a0a0a' },
  centreSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  frame: {
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderColor: 'rgba(232,210,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogram: { fontFamily: fontFamily.extraLight, color: GOLD },
  body: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 2,
  },
  label: { fontFamily: fontFamily.light, color: TEXT },
  eventLine: { fontFamily: fontFamily.light, color: DIM },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  codeRow: { flexDirection: 'row', alignItems: 'baseline' },
  codeLabel: { fontFamily: fontFamily.medium, color: MUTED },
  code: { fontFamily: fontFamily.medium, color: GOLD },
  footerUrl: { fontFamily: fontFamily.light, color: MUTED, textAlign: 'center' },
});
