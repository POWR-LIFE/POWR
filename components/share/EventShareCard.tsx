import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { EventLockup, lockupImageCount } from '@/components/events/EventLockup';
import { fontFamily } from '@/constants/tokens';
import type { EventShareEvent } from '@/lib/eventShare';
import { eventDateRange, eventNightLine, eventStatusChip, isVideoUrl } from '@/lib/liveEventDisplay';
import { storageImage } from '@/lib/storageImage';

/**
 * Chat clients centre-crop a 9:16 image to roughly 3:4 in the bubble, taking
 * ~12.5% off the top and bottom. Everything that has to survive the crop —
 * the eyebrow at the top, the code and the URL at the bottom — sits inside
 * this band. Same constant as ShareCard and PrizeShareCard, for the same
 * reason.
 */
const CROP_SAFE_Y = 250;

const GOLD  = '#E8D200';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.32)';

/** The hero lockup is 80/112/90dp at `large`; ×4.8 puts it at poster scale
 *  on the 1080 canvas without the venue logo's 512px source going soft. */
const LOCKUP_SCALE = 4.8;

interface EventShareCardProps extends ViewProps {
  event: EventShareEvent;
  /** The sharer's code, spelled out on the card — the only part of an invite
   *  that survives Instagram/TikTok stripping the caption. Null hides the row. */
  referralCode: string | null;
  /** Width in dp the card renders at. Height is derived 9:16. */
  width: number;
  /** Fires once every image on the card has painted (or errored). */
  onReady?: () => void;
}

/**
 * The event as a social card — what a member sends when they want a friend
 * at the event, not just a link to it.
 *
 * The identity is the hero card's own lockup (venue logo · divider · POWR
 * mark or uploaded event logo), rendered at poster size through
 * `EventLockup`'s `scale` so it can never drift from Home or the League
 * header. Beneath it the name (unless the event is logo-only), the promo
 * headline, then the three facts a friend needs — the night, the venue, the
 * scoring week — each labelled, because a bare date on an event card reads
 * as the date of the night and is usually a week out.
 *
 * Ground: the promo STILL when there is one, under the hero's scrim. Most
 * events carry a promo VIDEO (no still to capture), so the default ground
 * is a quiet dark gradient and the lockup carries the card — which is the
 * ask: "the logo and the POWR logo like the hero card".
 *
 * The bottom block is the invite: the code in gold and the POWR.LIFE mark,
 * because Stories strip the caption and the image has to carry the whole
 * ask on its own. Rendered off-screen at 720×1280 / 1080×1920 and captured
 * with react-native-view-shot, exactly like PrizeShareCard.
 */
export const EventShareCard = forwardRef<View, EventShareCardProps>(
  ({ event, referralCode, width, onReady, style, ...rest }, ref) => {
    const height = (width * 16) / 9;
    // Scale tokens proportionally to width — base sizes designed for 1080dp.
    const s = width / 1080;

    // promo_media_url is one field that may hold a video or a still; only a
    // still can be a ground. Ask storage for the card's own size.
    const media = event.promo_media_url;
    const stillUri = media && !isVideoUrl(media) ? storageImage(media, 1080, 1920) : null;

    // Readiness: the lockup's marks plus the ground still, if any. Each
    // reports load OR error once; the capture waits for all of them.
    const remaining = useRef(lockupImageCount(event) + (stillUri ? 1 : 0));
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

    const night = eventNightLine(event);
    const venueName = event.venue?.name ?? null;
    const live = event.status === 'live';

    return (
      <View ref={ref} collapsable={false} style={[styles.root, { width, height }, style]} {...rest}>
        {/* ── Ground ──────────────────────────────────────────────── */}
        {stillUri ? (
          <>
            <Image
              source={{ uri: stillUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={0}
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
              onLoadEnd={imageDone}
            />
            {/* Lightest at the top where the lockup sits, heaviest over the
                facts and the code — the League header's scrim, same reason. */}
            <LinearGradient
              colors={['rgba(10,10,10,0.35)', 'rgba(10,10,10,0.6)', 'rgba(10,10,10,0.94)']}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          </>
        ) : (
          <LinearGradient
            colors={['#1e1e1e', '#111111', '#0d0d0d']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        )}

        <View style={[styles.column, { paddingHorizontal: 80 * s, paddingTop: CROP_SAFE_Y * s, paddingBottom: CROP_SAFE_Y * s }]}>
          {/* ── Top: what this is, where it's up to ─────────────── */}
          <View style={styles.topRow}>
            <Text style={[styles.eyebrow, { fontSize: 26 * s, letterSpacing: 7 * s }]}>LIVE EVENT</Text>
            <View style={[styles.statusChip, { paddingHorizontal: 22 * s, paddingVertical: 12 * s, borderRadius: 100 * s, gap: 12 * s }]}>
              {live && <View style={[styles.liveDot, { width: 14 * s, height: 14 * s, borderRadius: 7 * s }]} />}
              <Text style={[styles.statusText, { fontSize: 22 * s, letterSpacing: 4 * s }]}>{eventStatusChip(event)}</Text>
            </View>
          </View>

          {/* ── Middle: the lockup, the name, the facts ─────────── */}
          <View style={styles.middle}>
            <EventLockup event={event} size="large" scale={LOCKUP_SCALE * s} onImageLoadEnd={imageDone} />

            {/* logo_only: the lockup IS the identity (the name still carries
                the caption, the preview title and the a11y label). */}
            {!event.logo_only && (
              <Text
                style={[styles.name, { fontSize: 92 * s, lineHeight: 100 * s, letterSpacing: -2.5 * s, marginTop: 56 * s }]}
                numberOfLines={2}
              >
                {event.name}
              </Text>
            )}
            {!!event.promo_headline && (
              <Text
                style={[styles.headline, { fontSize: 36 * s, lineHeight: 46 * s, marginTop: event.logo_only ? 56 * s : 20 * s }]}
                numberOfLines={2}
              >
                {event.promo_headline}
              </Text>
            )}

            <View style={{ marginTop: 72 * s, gap: 26 * s }}>
              {night && <Fact s={s} label="THE NIGHT" value={night} />}
              {venueName && <Fact s={s} label="WHERE" value={venueName} />}
              <Fact s={s} label="SCORING" value={eventDateRange(event)} />
            </View>
          </View>

          {/* ── Bottom: the invite ──────────────────────────────── */}
          <View>
            <View style={[styles.divider, { marginBottom: 40 * s }]} />
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
            {/* Instagram/TikTok strip share-sheet text, so the image itself
                must carry where to find us. */}
            <Text style={[styles.footerUrl, { fontSize: 24 * s, letterSpacing: 7 * s, marginTop: 44 * s }]}>
              POWR.LIFE
            </Text>
          </View>
        </View>
      </View>
    );
  },
);
EventShareCard.displayName = 'EventShareCard';

/** One labelled fact — label in the gutter, value beside it. */
function Fact({ s, label, value }: { s: number; label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={[styles.factLabel, { fontSize: 20 * s, letterSpacing: 4 * s, width: 210 * s, marginTop: 8 * s }]}>
        {label}
      </Text>
      <Text style={[styles.factValue, { fontSize: 36 * s, lineHeight: 44 * s }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
    position: 'relative',
  },
  column: { flex: 1, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontFamily: fontFamily.bold, color: GOLD },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  liveDot: { backgroundColor: '#4ade80' },
  statusText: { fontFamily: fontFamily.bold, color: TEXT },
  middle: { flex: 1, justifyContent: 'center' },
  name: { fontFamily: fontFamily.extraLight, color: TEXT },
  headline: { fontFamily: fontFamily.light, color: DIM },
  factRow: { flexDirection: 'row', alignItems: 'flex-start' },
  factLabel: { fontFamily: fontFamily.medium, color: MUTED },
  factValue: { flex: 1, fontFamily: fontFamily.light, color: TEXT },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  codeRow: { flexDirection: 'row', alignItems: 'baseline' },
  codeLabel: { fontFamily: fontFamily.medium, color: MUTED },
  code: { fontFamily: fontFamily.medium, color: GOLD },
  footerUrl: { fontFamily: fontFamily.light, color: MUTED, textAlign: 'center' },
});
