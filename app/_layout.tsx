import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import {
  Outfit_200ExtraLight,
  Outfit_300Light,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from '@expo-google-fonts/outfit';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';
import '../global.css';
import { AuthProvider } from '@/context/AuthContext';
import { GeofenceProvider } from '@/context/GeofenceContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { ThemeProvider as AppThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { registerWalkingSync } from '@/lib/health/walkingSync';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Required for OAuth redirects to complete on Android
WebBrowser.maybeCompleteAuthSession();

export const unstable_settings = {
  initialRouteName: 'index',
};

const APP_DARK_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0d0d0d' },
};

function RootLayoutNav() {
  const { theme } = useAppTheme();
  const [fontsLoaded] = useFonts({
    Outfit_200ExtraLight,
    Outfit_300Light,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

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
          <Stack.Screen name="edit-profile" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="activity-preferences" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="progress-detail" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="redeem-modal" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="share-stats" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="manual-log" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="points-ledger" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="achievements" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="admin-partners" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="privacy-policy" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="terms-of-service" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="help-centre" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="change-password" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="change-email" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="email-change-confirmed" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
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
          <NotificationsProvider>
            <RootLayoutNav />
          </NotificationsProvider>
        </AppThemeProvider>
      </GeofenceProvider>
    </AuthProvider>
  );
}
