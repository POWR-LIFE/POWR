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
import { Stack, usePathname, type ErrorBoundaryProps } from 'expo-router';
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
import CrashRecoveryScreen from '@/components/CrashRecoveryScreen';
import { flushCrashReports, noteRoute, reportHandled } from '@/lib/crashHandler';
import { registerWalkingSync } from '@/lib/health/walkingSync';
import { ensureAndroidChannels } from '@/lib/notifications';
import { useOtaUpdatePrompt } from '@/lib/otaUpdates';
import { registerPlacementNotifyTask } from '@/lib/placementNotifyTask';
import { registerStepGoalNotifyTask } from '@/lib/stepGoalNotifyTask';
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
  // The error is CAPTURED, not discarded. useFonts leaves `loaded` false forever
  // when loadAsync rejects, and this gate gated both the render below and the
  // only SplashScreen.hideAsync() in the app — so a font failure meant a
  // permanent splash screen with no error, no timeout and no way out. Rendering
  // in a fallback typeface is strictly better than not rendering at all.
  const [fontsLoaded, fontError] = useFonts({
    Outfit_200ExtraLight,
    Outfit_300Light,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });
  const fontsSettled = fontsLoaded || !!fontError;

  useEffect(() => {
    if (fontError) {
      // Not fatal, but never silent: the app is now running in a fallback
      // typeface and that should be visible in app_errors, not guesswork.
      reportHandled(fontError, { gate: 'useFonts' });
    }
  }, [fontError]);

  useEffect(() => {
    if (fontsSettled) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsSettled]);

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
    // Walkers' evening "X steps to finish today's POWR" nudge — same cadence,
    // same permission footprint (health read only, no location).
    registerStepGoalNotifyTask().catch(() => { /* non-fatal */ });
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
    // Send anything earlier launches left spooled — including the reports from
    // the launch that crashed, which by definition never got to send them
    // itself. Delayed so it never competes with first paint or the auth
    // bootstrap; this is diagnostics, and diagnostics go last.
    const t = setTimeout(() => flushCrashReports(), 4000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (pathname) trackScreen(pathname);
    // Gives a crash report the screen it happened on, and tells the reporter a
    // React tree exists at all — which is how a headless wake is told apart
    // from a backgrounded app.
    noteRoute(pathname ?? null);
  }, [pathname]);

  // Offer a restart when an OTA update is ready (launch + foreground checks).
  useOtaUpdatePrompt();

  if (!fontsSettled) {
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
          <Stack.Screen name="onboarding-wearables" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-account" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-profile" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-gym" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="onboarding-achievement" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="auth-email" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="profile-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="settings-screen" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="affiliate" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="affiliate-terms" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="affiliate-profile" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
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
          <Stack.Screen name="invite-code" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="email-change-confirmed" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="shared-challenge" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="join-challenge" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="friends" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="notifications" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="add-friend" options={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="my-qr" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="event-qr" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="share-prize" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="share-event" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="scan-friend" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
          <Stack.Screen name="circle-camera" options={{ presentation: 'fullScreenModal', headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }} />
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

/**
 * expo-router destructures this off the route module and wraps the default
 * export in its own Try boundary — in production as well as development — so it
 * sits above QueryClientProvider and catches a render error from any provider
 * below it.
 *
 * ⚠ THIS COMMENT USED TO CLAIM "Try also hides the splash screen itself, which
 * matters because RootLayoutNav returns null until the fonts load". THAT WAS
 * WRONG, and believing it is why the font gate above went unguarded long enough
 * to become a second never-resolves hang. expo-router has exactly three
 * hideAsync call sites and none of them fire on a healthy-but-stalled boot:
 *   • views/Try.js            — inside getDerivedStateFromError (error path only)
 *   • ExpoRoot.js             — inside shouldShowTutorial() (dev tutorial only)
 *   • renderRootComponent.js  — inside the catch around registerRootComponent
 * There is also utils/splash.js, which hides on any ErrorUtils error — but a
 * rejected font load is a caught promise rejection, not an ErrorUtils fatal, so
 * it never triggers. The effect above is the ONLY normal-path hideAsync in this
 * app; if it stops running, the splash stays up forever. Keep it unconditional
 * on a SETTLED gate, never on a SUCCESSFUL one.
 *
 * WHY THIS IS NOT OPTIONAL. lib/crashHandler stops an uncaught render error
 * aborting the process, but React has already committed {element: null} by then
 * — without a fallback the member would be left on a permanently blank screen,
 * which is a worse outcome than the crash it replaced. Suppressing the abort and
 * providing this screen are two halves of one change.
 *
 * The report is filed from an effect rather than during render because RN
 * stamps error.componentStack at commit time, and it is the component stack —
 * not the minified stack — that usually names what threw.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // React also reports a boundary-caught error through onCaughtError, which
    // the decorator sees — so this is a second sighting of one bug, not a second
    // bug. Both spellings of the message are normalised to the same fingerprint,
    // so they collapse into one row with a repeat count rather than two rows.
    reportHandled(error, undefined, 'error_boundary');
  }, [error]);

  return <CrashRecoveryScreen error={error} onRetry={retry} />;
}
