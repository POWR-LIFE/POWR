import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { VaultDoor } from '@/components/vault/VaultDoor';

const MUTED = 'rgba(255,255,255,0.35)';
/** Gold, matching potTokens ACCENT_SOFT — the one accent the Vault uses. */
const SOON_GOLD = 'rgba(232,210,0,0.72)';

/**
 * Vault entry point on the Rewards balance row: the safe glyph (white
 * monochrome) and its label — no amount, no background, no timer. All the
 * numbers and the live countdown live on the Vault screen itself.
 *
 * A GLYPH, deliberately — a baked render of the real 3D door was tried here
 * and sat too heavy against the page's line iconography (Jamie: "less
 * intrusive"). The hero owns the render; this row wants an icon. See
 * VaultDoor for why the icon is a floor-safe and not a round door.
 *
 * Pre-launch (a scheduled `vault_launch_at`, user outside the rollout) the
 * same glyph renders dimmed with a gold `sublabel` — "IN 3D" / "TODAY" — and
 * leads to the coming-soon state on /vault rather than nowhere.
 */
export function VaultWidget({
  onPress,
  sublabel,
}: {
  onPress: () => void;
  /** Set = coming-soon: dims the door and prints this under the wordmark. */
  sublabel?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      hitSlop={8}
    >
      <VaultDoor size={54} color={sublabel ? 'rgba(242,242,242,0.5)' : '#F2F2F2'} />
      <Text style={styles.label}>VAULT</Text>
      {sublabel ? <Text style={styles.sub}>{sublabel}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  label: { fontSize: 8, fontWeight: '600', letterSpacing: 2, color: MUTED },
  // Tighter than the wordmark: it hangs off the label rather than competing
  // with it, and gold is what marks it as an announcement.
  sub: { fontSize: 7, fontWeight: '700', letterSpacing: 1.5, color: SOON_GOLD, marginTop: -2 },
});
