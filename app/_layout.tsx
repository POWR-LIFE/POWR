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
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { Dimensions, View } from 'react-native';
import 'react-native-reanimated';
import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/context/AuthContext';
import { GeofenceProvider } from '@/context/GeofenceContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { ThemeProvider as AppThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { queryClient } from '@/lib/queryClient';
import { startAnalytics, trackScreen, trackTouch } from '@/lib/analytics';
import { registerWalkingSync } from '@/lib/health/walkingSync';
import { ensureAndroidChannels } from '@/lib/notifications';
import { useOtaUpdatePrompt } from '@/lib/otaUpdates';
import { registerPlacementNotifyTask } from '@/lib/placementNotifyTask';
import { refreshGymDwellMinutes } from '@/lib/gymDwellConfig';
import { supabase } from '@/lib/supabase';

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

  // Create Android notification channels at launch so any notification — local
  // or a remote push referencing a channel — always has a valid channel to land
  // in, rather than only after the user signs in.
  useEffect(() => {
    ensureAndroidChannels().catch((err) =>
      console.warn('[Notifications] Failed to create Android channels:', err),
    );
  }, []);

  // Register the placement zone-entry notifier at launch. Deliberately NOT in
  // GeofenceContext's startup path: that requires a home gym + "Always"
  // location, while this task needs neither (foreground permission + a cached
  // coarse fix) — placements must reach users the points geofence never will.
  useEffect(() => {
    registerPlacementNotifyTask().catch(() => { /* non-fatal */ });
  }, []);

  // Pull the admin-tunable gym dwell threshold (system_config →
  // min_gym_dwell_minutes) and cache it so the geofence dwell timer + home
  // progress ring match what claim-points actually rewards. Falls back to 30.
  //
  // system_config is authenticated-read only, so the launch fetch reads nothing
  // on a first-ever launch (fresh install, no session yet) and the process kept
  // the 30/40 defaults for its whole life (field 2026-07-14). Re-fetch whenever
  // a session becomes available so the first-ever gym visit uses real values.
  useEffect(() => {
    refreshGymDwellMinutes().catch(() => { /* keeps default */ });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        refreshGymDwellMinutes().catch(() => { /* keeps default */ });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Product analytics. One pathname subscription here covers every route in the
  // app — there is no per-screen instrumentation to add or to forget when a
  // screen is added later. trackScreen() de-duplicates repeat paths itself, and
  // the whole module is a no-op when the analytics_enabled switch is off.
  const pathname = usePathname();
  useEffect(() => {
    startAnalytics();
  }, []);
  useEffect(() => {
    if (pathname) trackScreen(pathname);
  }, [pathname]);

  // Offer a restart when an OTA update is ready (launch + foreground checks).
  useOtaUpdatePrompt();

  if (!fontsLoaded) {
    return null;
  }

  // Observes every touch in the app for the admin heatmap.
  //
  // onStartShouldSetResponderCapture runs on the CAPTURE phase, before any
  // child sees the touch, and returning false declines to become the responder
  // — so this reads the position and then gets out of the way completely. The
  // gesture continues to whatever button, scroll view or sheet was actually
  // touched, exactly as if this handler were not here. That matters: an earlier
  // instinct was to wrap things in an overlay View, and an invisible view over
  // the app is precisely how touches get swallowed.
  const onTouchCapture = (e: { nativeEvent: { pageX: number; pageY: number } }) => {
    const { width, height } = Dimensions.get('window');
    trackTouch(e.nativeEvent.pageX, e.nativeEvent.pageY, width, height);
    return false;
  };

  return (
    <View
      className={`theme-${theme} bg-theme-bg`}
      style={{ flex: 1, backgroundColor: '#0d0d0d' }}
      onStartShouldSetResponderCapture={onTouchCapture}
    >
      <ThemeProvider value={APP_DARK_THEME}>
        <Stack screenOptions={{ contentStyle: { backgroundColor: '#0d0d0d' } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-permission" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-permission-background" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-notifications" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-activities" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-health" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-account" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-profile" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-gym" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-achievement" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="auth-email" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="profile-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="settings-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="wearables" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="activity-preferences" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="progress-detail" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="redeem-modal" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="share-stats" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="manual-log" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="points-ledger" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="wallet" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="vault" options={{ headerShown: false, contentStyle: { backgroundColor: '#07090A' } }} />
          <Stack.Screen name="achievements" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="admin-partners" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="admin-challenges" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="challenges" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="privacy-policy" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="terms-of-service" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="help-centre" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="permissions-help" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="change-password" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="change-email" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="email-change-confirmed" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="shared-challenge" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="friends" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="notifications" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="add-friend" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="my-qr" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="scan-friend" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GeofenceProvider>
          <AppThemeProvider>
            <NotificationsProvider>
              <RootLayoutNav />
            </NotificationsProvider>
          </AppThemeProvider>
        </GeofenceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
