import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import type { WalletEntry } from '@/lib/api/rewards';

const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.32)';

interface RewardShareCardProps extends ViewProps {
  entry: WalletEntry;
  /** Width in dp the card will render at. Height is derived 4:5. */
  width: number;
  /** Fires once every remote image has finished loading (or there are none). */
  onReady?: () => void;
}

/**
 * Branded 4:5 share card for a wallet reward — hero image background, partner
 * logo, redemption code and a subtle POWR mark. Rendered off-screen and
 * captured with react-native-view-shot, same as ShareCard / share-stats.
 */
export const RewardShareCard = forwardRef<View, RewardShareCardProps>(
  ({ entry, width, onReady, style, ...rest }, ref) => {
    const height = (width * 5) / 4;
    // Scale tokens proportionally to width — base sizes designed for ~1080dp.
    const s = width / 1080;

    const heroUri = entry.reward_hero_image_url;
    const logoUri = entry.reward_image_url;
    // Without a hero shot, fall back to a heavily blurred partner logo.
    const bgUri = heroUri ?? logoUri;
    const isAffiliate = entry.integration_type === 'AFFILIATE';
    const title = entry.reward_title ?? 'Reward';

    // Signal readiness once every distinct remote image has loaded.
    const remaining = useRef(new Set([bgUri, logoUri].filter((u): u is string => !!u)).size);
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

    return (
      <View ref={ref} collapsable={false} style={[styles.root, { width, height }, style]} {...rest}>
        {/* Background — hero image, blurred logo, or gradient fallback */}
        {bgUri ? (
          <Image
            source={{ uri: bgUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            blurRadius={heroUri ? 0 : 60}
            transition={0}
            onLoadEnd={imageDone}
          />
        ) : (
          <LinearGradient colors={['#1a1a1a', '#0d0d0d']} style={StyleSheet.absoluteFillObject} />
        )}

        {/* Scrim — light at top, heavy behind the content */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.84)', 'rgba(0,0,0,0.96)']}
          locations={[0, 0.32, 0.68, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* ── Content (pinned to bottom) ─────────────────────────── */}
        <View style={[styles.body, { paddingHorizontal: 84 * s, paddingBottom: 72 * s }]}>
          {/* Partner logo — carries the brand on its own, no name text */}
          {logoUri ? (
            <Image
              source={{ uri: logoUri }}
              style={{ width: 280 * s, height: 240 * s }}
              contentFit="contain"
              transition={0}
              onLoadEnd={bgUri === logoUri ? undefined : imageDone}
            />
          ) : (
            <Text
              style={[styles.title, { fontSize: 68 * s, lineHeight: 78 * s, letterSpacing: 2 * s }]}
              numberOfLines={2}
            >
              {title.toUpperCase()}
            </Text>
          )}

          {/* Code / affiliate block */}
          <View style={[styles.codeBox, { borderRadius: 30 * s, borderWidth: Math.max(1, 2 * s), paddingVertical: 42 * s, paddingHorizontal: 36 * s, marginTop: 56 * s, gap: 16 * s }]}>
            {isAffiliate ? (
              <Text style={[styles.affiliateText, { fontSize: 30 * s, lineHeight: 42 * s }]}>
                Discount applied automatically at checkout
              </Text>
            ) : (
              <>
                <Text style={[styles.codeLabel, { fontSize: 22 * s, letterSpacing: 6 * s }]}>CODE</Text>
                <Text
                  style={[styles.codeText, { fontSize: 64 * s, letterSpacing: 9 * s }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {entry.code}
                </Text>
              </>
            )}
          </View>

          {/* Expiry */}
          {entry.expires_at ? (
            <Text style={[styles.expiry, { fontSize: 26 * s, marginTop: 30 * s }]}>
              Valid until {new Date(entry.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          ) : null}

          {/* Subtle POWR mark */}
          <View style={[styles.footer, { marginTop: 58 * s }]}>
            <Text style={[styles.footerLabel, { fontSize: 20 * s, letterSpacing: 5 * s }]}>EARNED WITH</Text>
            <Image
              source={require('@/assets/images/powrlogotext.png')}
              style={{ width: 280 * s, height: 84 * s, opacity: 0.85, marginTop: 6 * s }}
              contentFit="contain"
              transition={0}
            />
          </View>
        </View>
      </View>
    );
  },
);
RewardShareCard.displayName = 'RewardShareCard';

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
    position: 'relative',
  },
  body: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  title: {
    fontFamily: fontFamily.regular,
    color: TEXT,
    textAlign: 'center',
  },
  codeBox: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderColor: 'rgba(232,210,0,0.35)',
  },
  codeLabel: {
    fontFamily: fontFamily.semiBold,
    color: MUTED,
  },
  codeText: {
    fontFamily: fontFamily.extraLight,
    color: TEXT,
  },
  affiliateText: {
    fontFamily: fontFamily.light,
    color: DIM,
    textAlign: 'center',
  },
  expiry: {
    fontFamily: fontFamily.light,
    color: MUTED,
  },
  footer: {
    alignItems: 'center',
  },
  footerLabel: {
    fontFamily: fontFamily.medium,
    color: MUTED,
  },
});
