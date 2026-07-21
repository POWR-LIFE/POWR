import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { VaultDoor } from '@/components/vault/VaultDoor';

const MUTED = 'rgba(255,255,255,0.35)';

/**
 * Vault entry point on the Rewards balance row: just the door (white
 * monochrome) and its label — no amount, no background, no timer. All the
 * numbers and the live countdown live on the Vault screen itself.
 *
 * (Named VaultWidget, not VaultTimer — it shows no time, and the real
 * countdown component under the door on /vault already owns that name.)
 */
export function VaultWidget({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      hitSlop={8}
    >
      <VaultDoor size={54} color="#F2F2F2" />
      <Text style={styles.label}>VAULT</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  label: { fontSize: 8, fontWeight: '600', letterSpacing: 2, color: MUTED },
});
