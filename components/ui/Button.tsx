import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colours, components, typography } from '@/constants/tokens';

export type ButtonVariant = 'primary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = true,
  disabled,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  async function handlePress(e: Parameters<NonNullable<PressableProps['onPress']>>[0]) {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(e);
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        size === 'sm' && styles.sm,
        fullWidth && styles.fullWidth,
        pressed && styles[`${variant}Pressed` as keyof typeof styles],
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colours.onAccent : colours.accent}
        />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label` as keyof typeof styles]]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: components.button.height,
    paddingHorizontal: components.button.paddingH,
    borderRadius: components.button.borderRadius,
    borderWidth: components.button.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sm: {
    height: 36,
    paddingHorizontal: 14,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },

  // Variant backgrounds / borders
  primary: {
    backgroundColor: colours.accent,
    borderColor: colours.accent,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: colours.accent,
  },
  destructive: {
    backgroundColor: 'transparent',
    borderColor: colours.error,
  },

  // Pressed states
  primaryPressed: {
    opacity: 0.85,
  },
  ghostPressed: {
    backgroundColor: colours.accentGlow,
  },
  destructivePressed: {
    backgroundColor: colours.errorGlow,
  },

  disabled: {
    opacity: 0.38,
  },

  // Label styles
  label: {
    ...typography.cta,
  },
  primaryLabel: {
    color: colours.onAccent,
  },
  ghostLabel: {
    color: colours.accent,
  },
  destructiveLabel: {
    color: colours.error,
  },
});
