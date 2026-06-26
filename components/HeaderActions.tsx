import React from 'react';
import { StyleSheet, View } from 'react-native';

import { NotificationBell } from '@/components/NotificationBell';
import { ProfileButton } from '@/components/ProfileButton';

/**
 * Standard top-right header cluster shared across the tab screens: the Activity
 * bell (with its attention badge) next to the profile avatar.
 */
export function HeaderActions() {
  return (
    <View style={styles.row}>
      <NotificationBell />
      <ProfileButton />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
