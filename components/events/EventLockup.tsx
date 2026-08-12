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
 * Shared by the home card (over promo artwork) and the League header (over a
 * dark card) so the two can never drift apart.
 */
export function EventLockup({
    event,
    size = 'normal',
}: {
    event: Pick<LiveEvent, 'logo_url' | 'venue'>;
    size?: 'normal' | 'large';
}) {
    const large = size === 'large';
    const venueLogo = storageImage(event.venue?.logo_url, 512, 512);
    const chipVenue = !!venueLogo && event.venue?.logo_bg !== 'dark';
    const uploadedLogo = storageImage(event.logo_url, 512, 512);

    return (
        <View style={styles.lockupRow}>
            {venueLogo && (
                <>
                    <View style={chipVenue ? styles.venueChip : undefined}>
                        <ExpoImage
                            source={{ uri: venueLogo }}
                            style={large ? styles.venueLogoLarge : styles.venueLogo}
                            contentFit="contain"
                        />
                    </View>
                    <View style={[styles.lockupDivider, large && styles.lockupDividerLarge]} />
                </>
            )}
            {uploadedLogo ? (
                <ExpoImage
                    source={{ uri: uploadedLogo }}
                    style={large ? styles.uploadedLogoLarge : styles.uploadedLogo}
                    contentFit="contain"
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
                    style={large ? styles.powrMarkLarge : styles.powrMark}
                    resizeMode="contain"
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    lockupRow: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
        alignSelf: 'flex-start',
    },
    venueChip: {
        backgroundColor: '#FFFFFF',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    venueLogo: { width: 64, height: 22 },
    venueLogoLarge: { width: 80, height: 28 },
    // The line runs the width of the gym logo above it.
    lockupDivider: {
        width: 64,
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.45)',
    },
    lockupDividerLarge: { width: 80 },
    uploadedLogo: { width: 88, height: 32 },
    uploadedLogoLarge: { width: 112, height: 40 },
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
    powrMark: {
        width: 64,
        height: 64,
        marginVertical: -13,
        marginHorizontal: -10,
        backgroundColor: 'transparent',
    },
    powrMarkLarge: {
        width: 90,
        height: 90,
        marginVertical: -18,
        marginHorizontal: -14,
        backgroundColor: 'transparent',
    },
});
