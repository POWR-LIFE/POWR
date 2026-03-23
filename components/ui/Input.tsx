import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colours, components, spacing, typography } from '@/constants/tokens';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({ label, error, containerStyle, style, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label.toUpperCase()}</Text>}
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
          error && styles.inputError,
          style,
        ]}
        placeholderTextColor={colours.textMuted}
        selectionColor={colours.accent}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        {...rest}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    marginBottom: 2,
  },
  input: {
    height: components.input.height,
    backgroundColor: components.input.background,
    borderWidth: components.input.borderWidth,
    borderColor: components.input.border,
    borderRadius: components.input.borderRadius,
    paddingHorizontal: components.input.paddingH,
    color: colours.textPrimary,
    fontSize: typography.body.fontSize,
    fontFamily: typography.body.fontFamily,
  },
  inputFocused: {
    borderColor: components.input.focusBorder,
  },
  inputError: {
    borderColor: colours.error,
  },
  error: {
    ...typography.caption,
    color: colours.error,
  },
});
