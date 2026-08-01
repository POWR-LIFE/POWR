import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useWearableStatus } from '@/hooks/useWearableStatus';

// Status family, not brand palette. The header already carries a non-brand
// status colour (the bell's #EF4444 unread badge), so green/amber join an
// existing convention rather than introducing one. Brand gold is deliberately
// NOT used here: the profile avatar next door is solid gold, so a gold status
// dot would read as part of it.
const GREEN = '#22C55E';
const AMBER = '#F59E0B';
const WHITE = '#FFFFFF';

/**
 * Ambient wearable-status affordance for the home header.
 *
 * Renders NOTHING unless the user has a live wearable, so it costs the ~95% of
 * users without one exactly zero screen real estate. For those who do have one,
 * it answers "is my watch still feeding POWR?" — a question that previously had
 * no answer anywhere outside the Wearables screen, which nobody visits until
 * they already suspect something is wrong.
 *
 * Deliberately shows freshness, not connection state. A connected/disconnected
 * dot would have shown green throughout the five-week Whoop outage. The loud
 * half of this pairing is the 'wearable_silent' HealthGapBanner; this chip is
 * the quiet half, so a user sees amber before a banner interrupts them.
 *
 * Rendered as a BARE GLYPH at the same weight as the notification bell, not as
 * a filled tile. The header's rhythm is glyph → glyph → filled avatar: the
 * avatar is the only filled shape, which is what lets it terminate the row. A
 * second filled circle at a different diameter broke that. The trade is the
 * brand logo (dark marks like Garmin's need a white tile to be legible here) —
 * worth losing, because the user already knows which watch they own and the
 * question this answers is whether it's syncing. Brand identity lives on the
 * Wearables screen, one tap away.
 *
 * The healthy state carries a green dot rather than nothing. It's affirmative on
 * purpose: the complaint this feature answers is "users don't know their wearable
 * state", and an absent indicator doesn't tell anyone they're fine — it just
 * fails to alarm them. A visible green also builds the habit of glancing here,
 * which is what makes amber land later. Green is honest in a way the usual
 * connected-dot isn't, because it's driven by last_upload_at (data actually
 * arrived) rather than by authorisation state, which stayed green throughout the
 * five-week Whoop outage.
 */
export function WearableChip() {
  const router = useRouter();
  const { providerName, freshness, syncLabel } = useWearableStatus();

  if (freshness === 'none') return null;

  const attention = freshness === 'stale' || freshness === 'silent';

  return (
    <Pressable
      style={styles.btn}
      hitSlop={8}
      onPress={() => router.push('/wearables')}
      accessibilityRole="button"
      // The visual is a glyph and a colour; without this the state is invisible
      // to anyone using a screen reader, which is the whole point of the chip.
      accessibilityLabel={`${providerName ?? 'Wearable'}, ${syncLabel}. Open wearables.`}
    >
      <MaterialCommunityIcons
        name="watch-variant"
        size={22}
        color={attention ? AMBER : WHITE}
      />

      {/* Status dot, always in the same corner so the three states read as one
          escalating scale: green → amber → amber with a glyph. Bottom-right, not
          top-right, so it doesn't visually rhyme with the bell's unread badge —
          those mean very different things. */}
      <View style={[styles.badge, { backgroundColor: attention ? AMBER : GREEN }]}>
        {/* Only the interrupt-worthy state earns a glyph. The banner is
            dismissable for the day; this persists as the standing reminder. */}
        {freshness === 'silent' && <Text style={styles.badgeGlyph}>!</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Matches NotificationBell exactly; unclipped so the badge can overhang.
  btn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    // Matches the header background so the badge reads as a cutout, not a smudge.
    borderColor: '#0d0d0d',
  },
  badgeGlyph: {
    color: '#0a0a0a',
    fontSize: 8,
    lineHeight: 9,
    fontWeight: '900',
  },
});
