import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colours, spacing } from '@/constants/tokens';

interface ScreenProps {
  children: React.ReactNode;
  /** Add horizontal page padding (default: true) */
  padded?: boolean;
  /** Wrap content in a ScrollView */
  scroll?: boolean;
  /** Add KeyboardAvoidingView — useful for forms */
  keyboardAvoiding?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  padded = true,
  scroll = false,
  keyboardAvoiding = false,
  style,
  contentStyle,
}: ScreenProps) {
  const content = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[padded && styles.padded, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padded && styles.padded, contentStyle]}>
      {children}
    </View>
  );

  const inner = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {content}
    </KeyboardAvoidingView>
  ) : content;

  return (
    <SafeAreaView style={[styles.screen, style]}>
      {inner}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colours.bg,
  },
  fill: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.page,
  },
});
