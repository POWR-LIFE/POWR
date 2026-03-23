import { useRouter } from 'expo-router';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colours, iconSize, spacing, typography } from '@/constants/tokens';

interface HeaderProps {
  title?: string;
  /** Show a back arrow — defaults to true when title is present */
  showBack?: boolean;
  /** Optional right-side action slot */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Header({ title, showBack = true, right, style }: HeaderProps) {
  const router = useRouter();

  return (
    <View style={[styles.header, style]}>
      {/* Left: back button */}
      <View style={styles.side}>
        {showBack && router.canGoBack() && (
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}
          >
            {/* Chevron left — drawn with borders to avoid icon dependency */}
            <View style={styles.chevron} />
          </Pressable>
        )}
      </View>

      {/* Centre: title */}
      {title && (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      )}

      {/* Right: action slot */}
      <View style={[styles.side, styles.sideRight]}>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingHorizontal: spacing.page,
    borderBottomWidth: 1,
    borderBottomColor: colours.border,
  },
  side: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  backBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chevron: {
    width: iconSize.sm,
    height: iconSize.sm,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colours.textPrimary,
    transform: [{ rotate: '45deg' }],
    marginLeft: 4,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: typography.h3.fontFamily,
    fontSize: typography.h3.fontSize,
    letterSpacing: typography.h3.letterSpacing,
    color: colours.textPrimary,
  },
});
