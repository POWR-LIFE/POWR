import React from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';

const MUTED = 'rgba(255,255,255,0.35)';
/** Gold, matching potTokens ACCENT_SOFT — the one accent the Vault uses. */
const SOON_GOLD = 'rgba(232,210,0,0.72)';

/**
 * Vault entry point on the Rewards balance row: the door and its label — no
 * amount, no background, no timer. All the numbers and the live countdown
 * live on the Vault screen itself.
 *
 * The door is a RENDER of the real 3D model (the same object the /vault hero
 * draws live), not an icon of one. The parametric SVG that preceded it —
 * concentric rings and a spoked wheel — read as a TYRE at this size, which
 * is what a circle-plus-spokes glyph is; Jamie caught it. The asset is baked
 * from vaultDoorModel.js head-on (fov 22 @ z 7.3, sealed, timer ring full)
 * with the lights pushed for icon scale (exposure 1.55, light 1.8) — at the
 * hero's own grade, dark steel in a black room disappears into the card.
 * Re-bake after any door redesign: scratchpad harness, or re-run the recipe
 * in the vault memory.
 *
 * Pre-launch (a scheduled `vault_launch_at`, user outside the rollout) the
 * same door renders dimmed with a gold `sublabel` — "IN 3D" / "TODAY" — and
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
      <Image
        source={require('@/assets/images/vault_door_icon.png')}
        style={[styles.door, sublabel != null && { opacity: 0.55 }]}
        resizeMode="contain"
      />
      <Text style={styles.label}>VAULT</Text>
      {sublabel ? <Text style={styles.sub}>{sublabel}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  door: { width: 54, height: 54 },
  label: { fontSize: 8, fontWeight: '600', letterSpacing: 2, color: MUTED },
  // Tighter than the wordmark: it hangs off the label rather than competing
  // with it, and gold is what marks it as an announcement.
  sub: { fontSize: 7, fontWeight: '700', letterSpacing: 1.5, color: SOON_GOLD, marginTop: -2 },
});
