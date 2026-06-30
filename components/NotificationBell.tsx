import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNotifications } from '@/context/NotificationsContext';

/**
 * Header bell + badge. Opens the Activity screen, where friend requests and
 * challenge invites are accepted/declined inline ("Needs you") and past events
 * are listed ("Recent"). The badge sums items awaiting a response and unread
 * feed items; it's re-pulled on focus so it clears once dealt with.
 */
export function NotificationBell() {
  const router = useRouter();
  const { bellCount, refreshPendingActions, refreshActivity } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      refreshPendingActions();
      refreshActivity();
    }, [refreshPendingActions, refreshActivity]),
  );

  const count = bellCount;

  return (
    <Pressable
      style={styles.btn}
      hitSlop={8}
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0 ? `Activity, ${count} new item${count === 1 ? '' : 's'}` : 'Activity'
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
