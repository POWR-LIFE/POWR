import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNotifications } from '@/context/NotificationsContext';

/**
 * Header bell + "needs your attention" badge. Opens the Activity screen, where
 * friend requests and challenge invites are accepted/declined inline. Re-pulls
 * the count on focus so the badge clears once the user has dealt with things.
 */
export function NotificationBell() {
  const router = useRouter();
  const { pendingActions, refreshPendingActions } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      refreshPendingActions();
    }, [refreshPendingActions]),
  );

  const count = pendingActions.total;

  return (
    <Pressable
      style={styles.btn}
      hitSlop={8}
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0 ? `Activity, ${count} item${count === 1 ? '' : 's'} need your attention` : 'Activity'
      }
    >
      <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Unclipped so the badge can overhang the bell's top-right.
  btn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#0d0d0d',
  },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#FFFFFF' },
});
