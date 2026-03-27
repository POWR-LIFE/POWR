import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import 'react-native-reanimated';
import '../global.css';

// Required for OAuth redirects to complete on Android
WebBrowser.maybeCompleteAuthSession();

import { AuthProvider } from '@/context/AuthContext';
import { GeofenceProvider } from '@/context/GeofenceContext';
import { ThemeProvider as AppThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { View } from 'react-native';

export const unstable_settings = {
  initialRouteName: 'index',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { theme } = useAppTheme();

  return (
    <View className={`theme-${theme} bg-theme-bg`} style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-permission" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-health" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-account" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-achievement" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="auth-email" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="profile-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="settings-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="progress-detail" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="redeem-modal" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', contentStyle: { backgroundColor: 'transparent' } }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </View>
  );
}

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
