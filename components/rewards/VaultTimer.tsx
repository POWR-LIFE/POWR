import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { VaultDoor } from '@/components/vault/VaultDoor';

const TEXT  = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.35)';
const DIM   = 'rgba(255,255,255,0.55)';

/**
 * Vault-door entry point on the Rewards balance row: the door graphic, the
 * vesting total, and a label — deliberately quiet (no background, no timer;
 * the live countdown lives on the Vault screen itself). Renders an inviting
 * empty state so the feature is discoverable before the first deposit banks.
 */
export function VaultTimer({
  pending,
  nextVestAt: _nextVestAt,
  onPress,
}: {
  pending: number;
  nextVestAt: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      hitSlop={8}
    >
      <VaultDoor size={54} />
      {pending > 0 ? (
        <Text style={styles.amount}>+{pending.toLocaleString()}</Text>
      ) : (
        <Text style={styles.emptyText}>Bonus POWR</Text>
      )}
      <Text style={styles.label}>VAULT</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 3, paddingHorizontal: 6 },
  amount: { fontSize: 14, fontWeight: '500', color: TEXT, letterSpacing: 0.3 },
  emptyText: { fontSize: 10, fontWeight: '300', color: DIM },
  label: { fontSize: 8, fontWeight: '600', letterSpacing: 2, color: MUTED },
});
