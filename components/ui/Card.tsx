import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colours, components } from '@/constants/tokens';

interface CardProps {
  children: React.ReactNode;
  active?: boolean;
  onPress?: PressableProps['onPress'];
  style?: StyleProp<ViewStyle>;
  /** Remove default padding — useful when nesting full-bleed content */
  noPadding?: boolean;
}

export function Card({ children, active = false, onPress, style, noPadding = false }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={async (e) => {
          await Haptics.selectionAsync();
          onPress(e);
        }}
        style={({ pressed }) => [
          styles.card,
          active && styles.active,
          pressed && styles.pressed,
          noPadding && styles.noPadding,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, active && styles.active, noPadding && styles.noPadding, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: components.card.background,
    borderWidth: components.card.borderWidth,
    borderColor: components.card.border,
    borderRadius: components.card.borderRadius,
    padding: components.card.padding,
  },
  active: {
    borderColor: colours.accent,
    backgroundColor: components.card.activeBackground,
  },
  pressed: {
    opacity: 0.85,
  },
  noPadding: {
    padding: 0,
  },
});
