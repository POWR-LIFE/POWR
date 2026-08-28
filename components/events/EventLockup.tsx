import { Image as ExpoImage } from 'expo-image';
import React from 'react';
import { Image as NativeImage, StyleSheet, View } from 'react-native';

import type { LiveEvent } from '@/lib/api/liveEvents';
import { storageImage } from '@/lib/storageImage';

// The default POWR side of the lockup. Hosted (not bundled) so the standard
// mark can be swapped in storage without shipping an update. Same square
// white-on-transparent canvas as the mark it replaced — its padding measures
// within a pixel or two of it on every side, so the trim below still lands.
const POWR_MARK_URL =
    'https://auth.powr.life/storage/v1/object/public/powr-level-logo/move-machine.png';

/**
 * How many images the lockup will paint for this event — the share card
 * waits for exactly this many `onImageLoadEnd` calls before it captures.
 * The POWR side always renders one image (uploaded logo OR the bundled mark);
 * the venue side renders one more when the venue has a logo.
 */
export function lockupImageCount(event: Pick<LiveEvent, 'logo_url' | 'venue'>): number {
    return (event.venue?.logo_url ? 1 : 0) + 1;
}

/**
 * The event identity mark: a VERTICAL partnership lockup — venue logo small,
 * a divider the same width as it, then the POWR side larger beneath.
 *
 * Precedence on the POWR side: uploaded event logo → bundled white POWR mark,
 * so the lockup never renders markless. Chip rules are the promo-page
 * convention and deliberately asymmetric:
 *   - venue logos marked 'dark' sit raw, everything else gets a white chip
 *     (dark-on-transparent venue marks would vanish otherwise);
 *   - the POWR side is NEVER chipped — uploads must be white-on-transparent,
 *     which the admin upload hint and its dark preview tile both state.
 *
 * Shared by the home card (over promo artwork), the League header (over a
 * dark card) and the event share card (at poster size, via `scale`) so the
 * three can never drift apart.
 *
 * `scale` multiplies every dimension — the share card renders the same
 * lockup at 1080-wide poster size rather than re-drawing it. `onImageLoadEnd`
 * fires once per image (load OR error) so a capture can wait for the marks
 * to paint; see `lockupImageCount` for how many to expect.
 */
export function EventLockup({
    event,
    size = 'normal',
    scale = 1,
    onImageLoadEnd,
}: {
    event: Pick<LiveEvent, 'logo_url' | 'venue'>;
    size?: 'normal' | 'large';
    scale?: number;
    onImageLoadEnd?: () => void;
}) {
    const large = size === 'large';
    const k = scale;
    const venueLogo = storageImage(event.venue?.logo_url, 512, 512);
    const chipVenue = !!venueLogo && event.venue?.logo_bg !== 'dark';
    const uploadedLogo = storageImage(event.logo_url, 512, 512);

    // Every tuned dp value below is the ORIGINAL StyleSheet number × scale, so
    // the default (scale 1) renders pixel-for-pixel what it always did.
    const venueDims = large
        ? { width: 80 * k, height: 28 * k }
        : { width: 64 * k, height: 22 * k };
    // The line runs the width of the gym logo above it.
    const dividerDims = { width: (large ? 80 : 64) * k, height: Math.max(1, k) };
    const uploadedDims = large
        ? { width: 112 * k, height: 40 * k }
        : { width: 88 * k, height: 32 * k };
    const markDims = large
        ? {
            width: mark(90) * k,
            height: mark(90) * k,
            marginVertical: mark(-18) * k,
            marginHorizontal: mark(-14) * k,
        }
        : {
            width: mark(64) * k,
            height: mark(64) * k,
            marginVertical: mark(-13) * k,
            marginHorizontal: mark(-10) * k,
        };

    return (
        <View style={[styles.lockupRow, { gap: 8 * k }]}>
            {venueLogo && (
                <>
                    <View
                        style={
                            chipVenue
                                ? [
                                    styles.venueChip,
                                    { borderRadius: 10 * k, paddingHorizontal: 8 * k, paddingVertical: 6 * k },
                                ]
                                : undefined
                        }
                    >
                        <ExpoImage
                            source={{ uri: venueLogo }}
                            style={venueDims}
                            contentFit="contain"
                            onLoadEnd={onImageLoadEnd}
                        />
                    </View>
                    <View style={[styles.lockupDivider, dividerDims]} />
                </>
            )}
            {uploadedLogo ? (
                <ExpoImage
                    source={{ uri: uploadedLogo }}
                    style={uploadedDims}
                    contentFit="contain"
                    onLoadEnd={onImageLoadEnd}
                />
            ) : (
                // react-native's Image, NOT expo-image, and deliberately so: over
                // the promo video expo-image composites this artwork's transparent
                // pixels onto black, drawing a solid box around the mark. The old
                // solid-fill mark hid it; outline art does not. The achievements
                // grid renders the same PNGs through NativeImage for this reason
                // (app/achievements.tsx) — this is the same fix at the same layer.
                <NativeImage
                    source={{ uri: POWR_MARK_URL }}
                    style={[styles.powrMark, markDims]}
                    resizeMode="contain"
                    onLoadEnd={onImageLoadEnd}
                />
            )}
        </View>
    );
}

// Two successive 5% trims on the POWR mark (2026-08-14), compounded rather than
// added: 0.95 × 0.95. The dimensions above apply it to the ORIGINAL tuned
// values, so the sizes and their trim margins can never drift apart, and a
// third pass is a one-number change here instead of six rounded literals.
const MARK_SCALE = 0.95 * 0.95;
const mark = (tuned: number) => tuned * MARK_SCALE;

const styles = StyleSheet.create({
    lockupRow: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        alignSelf: 'flex-start',
    },
    venueChip: {
        backgroundColor: '#FFFFFF',
    },
    lockupDivider: {
        backgroundColor: 'rgba(255,255,255,0.45)',
    },
    // The mark is a square canvas with its own padding — negative margins trim
    // it so the visible mark aligns with the row, not the canvas. Tuned to this
    // artwork's measured padding: 15% left, 20% bottom. Left and bottom are the
    // load-bearing sides (they set the alignment with the text and the gap to
    // the row below); the other two only affect a width nothing measures.
    //
    // The explicit transparent background is load-bearing, not decoration: over
    // the promo video this mark otherwise composites onto black and reads as a
    // solid box around the logo. The achievements grid carries the same explicit
    // 'transparent' on its level artwork for the same reason — this is the one
    // place in the lockup that never got it.
    //
    // Every number is the TUNED value put through MARK_SCALE (× the caller's
    // scale), never a hand-edited literal — the margins are fractions of the
    // canvas, so shrinking the mark without scaling them by the same factor
    // stops the trim landing on the padding. Change the scale, not the numbers.
    powrMark: {
        backgroundColor: 'transparent',
    },
});
