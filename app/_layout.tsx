import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import 'react-native-reanimated';
import '../global.css';

// Required for OAuth redirects to complete on Android
WebBrowser.maybeCompleteAuthSession();

import { AuthProvider } from '@/context/AuthContext';
import { GeofenceProvider } from '@/context/GeofenceContext';
import { registerWalkingSync } from '@/lib/health/walkingSync';
import { ThemeProvider as AppThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { View } from 'react-native';

export const unstable_settings = {
  initialRouteName: 'index',
};

const APP_DARK_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0d0d0d' },
};

function RootLayoutNav() {
  const { theme } = useAppTheme();

  return (
    <View className={`theme-${theme} bg-theme-bg`} style={{ flex: 1, backgroundColor: '#0d0d0d' }}>
      <ThemeProvider value={APP_DARK_THEME}>
        <Stack screenOptions={{ contentStyle: { backgroundColor: '#0d0d0d' } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-permission" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-activities" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-health" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-account" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-achievement" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="auth-email" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="profile-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="settings-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="progress-detail" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="redeem-modal" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="manual-log" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="admin-partners" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', contentStyle: { backgroundColor: 'transparent' } }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </View>
  );
}

// Register background walking sync (no-op on web/simulator)
registerWalkingSync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <GeofenceProvider>
        <AppThemeProvider>
          <RootLayoutNav />
        </AppThemeProvider>
      </GeofenceProvider>
    </AuthProvider>
  );
}
