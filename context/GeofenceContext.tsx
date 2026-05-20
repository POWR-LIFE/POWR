import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';

// ─── Session-completed event bus ─────────────────────────────────────────────
// Fires synchronously in the JS thread when a foreground claim succeeds.
// Allows any hook (e.g. usePoints) to refresh without polling AsyncStorage.

type SessionCompletedListener = () => void;
const _sessionCompletedListeners = new Set<SessionCompletedListener>();

export function onSessionCompleted(listener: SessionCompletedListener): () => void {
  _sessionCompletedListeners.add(listener);
  return () => _sessionCompletedListeners.delete(listener);
}

function _emitSessionCompleted() {
  _sessionCompletedListeners.forEach(l => l());
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
  open: string;   // "HH:MM"
  close: string;  // "HH:MM"
}

export type OpeningHours = Partial<Record<DayKey, DayHours | null>>;

export interface Partner {
  id: string;
  name: string;
  description?: string;
  category: string;
  status: string;
  address: string;
  area: string;
  pts: number;
  distance: string;
  logoText: string;
  logoUrl?: string;
  logoBg: 'dark' | 'black' | 'white';
  logoLight: boolean;
  image1Url?: string;
  image2Url?: string;
  lat: number;
  lng: number;
  geofenceRadius: number;
  openingHours?: OpeningHours;
  isOpenNow: boolean;
}

export interface Trainer {
  id: string;
  partner_id: string;
  name: string;
  photo_url: string | null;
  bio: string | null;
  specialties: string[] | null;
  experience: string | null;
  profile_url: string | null;
  booking_url: string | null;
  active: boolean;
  sort_order: number;
}

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function checkIsOpenNow(openingHours?: OpeningHours): boolean {
  if (!openingHours) return true; // no hours set → assume open
  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  const hours = openingHours[dayKey];
  if (!hours) return false; // explicitly closed today
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const openMins  = oh * 60 + om;
  // Treat 00:00 close as end-of-day (1440) so "open until midnight" works correctly
  const closeMins = (ch === 0 && cm === 0) ? 1440 : ch * 60 + cm;
  return nowMins >= openMins && nowMins < closeMins;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GEOFENCE_TASK_NAME     = 'GEOFENCE_CHECK_IN';
const ACTIVE_GEOFENCE_KEY    = '@powr/active_geofence';
const PARTNER_MAP_KEY        = '@powr/partner_map';
const SESSION_COMPLETED_KEY  = '@powr/session_completed';

// ⚠️ DEV OVERRIDES — restore before release
const MIN_DWELL_MS  = __DEV__ ? 30 * 1000 : 20 * 60 * 1000;
// Production eligibility minimum — used for pointsPending retry regardless of MIN_DWELL_MS
const PROD_DWELL_MS   = 20 * 60 * 1000;
const PROD_UPGRADE_MS = 45 * 60 * 1000;
const DEV_RADIUS_M: Record<string, number> = {
  'POWR Test Gym': 2,
};

// ─── Stored geofence shape ────────────────────────────────────────────────────

interface StoredGeofence {
  partnerId:        string;
  partnerName:      string;
  entryTimestamp:   number;
  latitude?:        number;
  longitude?:       number;
  radius?:          number;
  sessionRecorded?: boolean; // true once session has been written to DB
  pointsPending?:   boolean; // true if session exists but claim was too short — retry on exit
  sessionId?:       string;  // set after the initial 20-min claim succeeds
  tierUpgraded?:    boolean; // true once the 45-min upgrade has been attempted
}

// ─── Shared session recording ─────────────────────────────────────────────────
// Called by both the foreground dwell timer and the background exit handler.

async function recordDwellSession(activeGeofence: StoredGeofence): Promise<{ outcome: 'claimed' | 'too_short' | 'error'; sessionId?: string }> {
  const dwellMs = Date.now() - activeGeofence.entryTimestamp;
  try {
    const { data: { session: authSession }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !authSession?.user) {
      console.error('[Geofence] Token refresh failed — cannot record session:', refreshError?.message ?? 'no session');
      return { outcome: 'error' };
    }
    const user = authSession.user;

    const startedAt   = new Date(activeGeofence.entryTimestamp);
    const endedAt     = new Date();
    const durationSec = Math.round(dwellMs / 1000);

    const { getDeviceId } = await import('@/lib/device');
    const deviceId = await getDeviceId();

    let sessionId: string;

    const { data: session, error: sessionError } = await supabase
      .from('activity_sessions')
      .insert({
        user_id:      user.id,
        type:         'gym',
        started_at:   startedAt.toISOString(),
        ended_at:     endedAt.toISOString(),
        duration_sec: durationSec,
        verification: 'geofence',
        trust_score:  0.94,
        device_id:    deviceId,
        partner_id:   activeGeofence.partnerId,
        raw_gps:      {
          partnerId:      activeGeofence.partnerId,
          partnerName:    activeGeofence.partnerName,
          entryTimestamp: activeGeofence.entryTimestamp,
        },
      })
      .select()
      .single();

    if (sessionError) {
      if (sessionError.code === '23505') {
        // Session already exists (recorded when duration was too short) — update to actual elapsed time
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: existing } = await supabase
          .from('activity_sessions')
          .select('id')
          .eq('user_id', user.id)
          .eq('type', 'gym')
          .gte('started_at', today.toISOString())
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        if (!existing) {
          console.error('[Geofence] 23505 but could not find existing session');
          return { outcome: 'error' };
        }

        await supabase
          .from('activity_sessions')
          .update({ ended_at: endedAt.toISOString(), duration_sec: durationSec })
          .eq('id', existing.id);

        sessionId = existing.id;
        console.log(`[Geofence] Updated existing session to ${Math.round(durationSec / 60)}min.`);
      } else {
        console.error('[Geofence] Failed to create session:', sessionError);
        return { outcome: 'error' };
      }
    } else {
      if (!session) return { outcome: 'error' };
      sessionId = session.id;
    }

    const { data: claimData, error: claimError } = await supabase.functions.invoke('claim-points', {
      body: { session_id: sessionId },
    });

    if (claimError) {
      const body = await (claimError as any)?.context?.json?.().catch(() => null);
      console.error('[Geofence] Claim points error:', body ?? claimError.message);
      if (body?.error === 'Session does not meet eligibility minimum') {
        return { outcome: 'too_short' };
      }
      return { outcome: 'error' };
    }

    // Points successfully claimed — now surface completion to the app
    await AsyncStorage.setItem(
      SESSION_COMPLETED_KEY,
      JSON.stringify({ partnerName: activeGeofence.partnerName, durationSec, timestamp: Date.now() }),
    );

    // Notify all in-process listeners (e.g. usePoints) immediately
    _emitSessionCompleted();

    console.log(`[Geofence] Points claimed after ${Math.round(dwellMs / 60000)}min dwell.`, claimData);
    return { outcome: 'claimed', sessionId };
  } catch (err) {
    console.error('[Geofence] recordDwellSession failed:', err);
    return { outcome: 'error' };
  }
}

// ─── Gym tier upgrade ─────────────────────────────────────────────────────────
// Called when a session crosses the 45-min threshold. Awards the delta between
// what was claimed at the 20-min tier and the 45-min tier target.

async function upgradeGymTier(sessionId: string): Promise<void> {
  try {
    const { error: fnError } = await supabase.functions.invoke('upgrade-gym-tier', {
      body: { session_id: sessionId },
    });
    if (fnError) {
      console.warn('[Geofence] Tier upgrade failed:', fnError.message);
    } else {
      console.log('[Geofence] Gym session upgraded to 45-min tier.');
      _emitSessionCompleted();
    }
  } catch (err) {
    console.warn('[Geofence] upgradeGymTier error:', err);
  }
}

// ─── Background Task ──────────────────────────────────────────────────────────
// Defined at module level so it is registered before any geofencing starts.

TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[Geofence] Task error:', error);
    return;
  }

  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };

  if (eventType === Location.GeofencingEventType.Enter) {
    // Don't overwrite an already-active session
    const existingRaw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (existingRaw) {
      console.log('[Geofence] Enter ignored — session already active.');
      return;
    }

    // One gym session per day — skip if already completed
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from('activity_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('type', 'gym')
          .gte('started_at', today.toISOString());
        if ((count ?? 0) > 0) {
          console.log('[Geofence] Gym session already logged today — entry ignored.');
          return;
        }
      }
    } catch {
      // Non-fatal — proceed with entry recording
    }

    const regionId = region.identifier ?? '';
    const mapJson = await AsyncStorage.getItem(PARTNER_MAP_KEY);
    const partnerMap: Record<string, string> = mapJson ? JSON.parse(mapJson) : {};
    const partnerName = partnerMap[regionId] ?? regionId;

    await AsyncStorage.setItem(
      ACTIVE_GEOFENCE_KEY,
      JSON.stringify({
        partnerId:      regionId,
        partnerName,
        entryTimestamp: Date.now(),
        latitude:       region.latitude,
        longitude:      region.longitude,
        radius:         region.radius,
      })
    );
    console.log(`[Geofence] Entered "${partnerName}"`);

    try {
      const { notifyCheckInAvailable } = await import('@/lib/notifications');
      await notifyCheckInAvailable(partnerName, regionId);
    } catch (err) {
      console.warn('[Geofence] Entry notification failed:', err);
    }

  } else if (eventType === Location.GeofencingEventType.Exit) {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    const activeGeofence: StoredGeofence | null = raw ? JSON.parse(raw) : null;

    await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);

    if (!activeGeofence) return;

    // Foreground dwell timer already recorded AND claimed this session
    if (activeGeofence.sessionRecorded && !activeGeofence.pointsPending) {
      const dwellMs = Date.now() - activeGeofence.entryTimestamp;
      if (dwellMs >= PROD_UPGRADE_MS && activeGeofence.sessionId && !activeGeofence.tierUpgraded) {
        console.log('[Geofence] Exit: session crossed 45-min tier — upgrading.');
        await upgradeGymTier(activeGeofence.sessionId);
      } else {
        console.log('[Geofence] Exit: session already recorded by foreground timer — skipping.');
      }
      return;
    }

    const dwellMs = Date.now() - activeGeofence.entryTimestamp;
    if (dwellMs < MIN_DWELL_MS) {
      console.log(`[Geofence] Dwell ${Math.round(dwellMs / 60000)}min < threshold — no points.`);
      return;
    }

    const { outcome: exitOutcome, sessionId: exitSessionId } = await recordDwellSession(activeGeofence);
    if (exitOutcome === 'claimed' && exitSessionId) {
      try {
        const { notifySessionCompleted } = await import('@/lib/notifications');
        await notifySessionCompleted(activeGeofence.partnerName, exitSessionId);
      } catch (err) {
        console.warn('[Geofence] Exit notification failed:', err);
      }
    }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Row formatter ────────────────────────────────────────────────────────────

function formatPartnerRows(data: any[]): Partner[] {
  const formatted: Partner[] = [];
  data.forEach((p: any) => {
    if (!p.locations) return;
    const locs = Array.isArray(p.locations) ? p.locations : [p.locations];
    locs.forEach((loc: any, idx: number) => {
      if (loc.lat == null || loc.lng == null || !isFinite(loc.lat) || !isFinite(loc.lng)) return;
      const words = p.name.split(' ');
      const logoText = words.length > 1
        ? `${words[0]}\n${words[1]}`.toUpperCase()
        : p.name.toUpperCase();
      const oh: OpeningHours | undefined = p.opening_hours ?? undefined;
      const openNow = checkIsOpenNow(oh);
      formatted.push({
        id:             `${p.id}-${idx}`,
        name:           p.name,
        description:    p.description ?? undefined,
        category:       p.category.charAt(0).toUpperCase() + p.category.slice(1),
        status:         openNow ? 'Open now' : 'Closed',
        address:        p.address?.trim() || '',
        area:           (loc.address?.trim() || loc.name?.trim()) || 'Local',
        pts:            p.category.toLowerCase() === 'gym' ? 15 : 10,
        distance:       '',
        logoText:       logoText.length > 10 ? logoText.substring(0, 10) : logoText,
        logoUrl:        p.logo_url,
        logoBg:         (p.logo_bg as 'dark' | 'black' | 'white') ?? 'dark',
        logoLight:      p.category.toLowerCase() !== 'gym',
        image1Url:      p.image1_url ?? undefined,
        image2Url:      p.image2_url ?? undefined,
        lat:            loc.lat,
        lng:            loc.lng,
        geofenceRadius: DEV_RADIUS_M[p.name] ?? loc.radius ?? 50,
        openingHours:   oh,
        isOpenNow:      openNow,
      });
    });
  });
  return formatted;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface GeofenceContextValue {
  partners: Partner[];
  isMonitoring: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const GeofenceContext = createContext<GeofenceContextValue>({
  partners: [],
  isMonitoring: false,
  loading: true,
  refresh: async () => {},
});

export function GeofenceProvider({ children }: { children: React.ReactNode }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const fingerprintRef = useRef('');
  const dwellTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Get last-known position quickly (no GPS warmup) to filter partners by proximity.
      // Falls back to fetching all active partners if location is unavailable.
      let data: any[] | null = null;

      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      if (pos) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('nearby_partners', {
          user_lat:   pos.coords.latitude,
          user_lng:   pos.coords.longitude,
          radius_deg: 0.15, // ~15 km bounding box
        });
        if (!rpcError) data = rpcData;
      }

      // Fallback: fetch all if no location or RPC failed
      if (!data) {
        const { data: allData, error } = await supabase
          .from('partners')
          .select('id, name, description, category, address, locations, logo_url, logo_bg, image1_url, image2_url, opening_hours')
          .eq('active', true);
        if (error || !allData) return;
        data = allData;
      }

      if (!data) return;

      setPartners(formatPartnerRows(data));
    } finally {
      setLoading(false);
    }
  }, []);

  // Foreground dwell timer — awards points immediately at the threshold without requiring an exit event.
  // Polls every 10 s to catch geofence entries that happen while the app is already open.
  // The background task exit handler is the fallback when the app is backgrounded/killed.
  const scheduleDwellTimer = useCallback(async () => {
    if (dwellTimerRef.current != null) return; // timer already running

    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (!raw) return;

    const activeGeofence: StoredGeofence = JSON.parse(raw);

    // Skip only if the completion belongs to THIS session (timestamp after entry).
    // A stale key from a previous visit (timestamp before current entry) should not
    // block the foreground timer for new sessions.
    const completedRaw = await AsyncStorage.getItem(SESSION_COMPLETED_KEY);
    if (completedRaw) {
      const completed: { timestamp: number } = JSON.parse(completedRaw);
      if (completed.timestamp >= activeGeofence.entryTimestamp) return;
    }

    // If the previous claim attempt failed (session too short at the time), retry as soon
    // as the production eligibility threshold is met — don't wait for exit.
    if (activeGeofence.sessionRecorded && activeGeofence.pointsPending) {
      const elapsed    = Date.now() - activeGeofence.entryTimestamp;
      const remaining  = PROD_DWELL_MS - elapsed;
      if (remaining <= 0) {
        console.log('[Geofence] Foreground: retrying pending claim now (production threshold met).');
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, pointsPending: false }));
        const { outcome } = await recordDwellSession(activeGeofence);
        if (outcome !== 'claimed') {
          // Still failing — restore flag and keep retrying via the poll interval
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, pointsPending: true }));
          console.log('[Geofence] Retry claim failed — will try again.');
        }
      } else {
        console.log(`[Geofence] Foreground: scheduling pending-claim retry in ${Math.round(remaining / 1000)}s`);
        dwellTimerRef.current = setTimeout(async () => {
          dwellTimerRef.current = null;
          const raw2 = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
          if (!raw2) return;
          const gf: StoredGeofence = JSON.parse(raw2);
          if (!gf.pointsPending) return;
          console.log('[Geofence] Foreground: pending-claim retry timer fired.');
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, pointsPending: false }));
          const { outcome } = await recordDwellSession(gf);
          if (outcome !== 'claimed') {
            await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, pointsPending: true }));
            console.log('[Geofence] Retry claim failed — poll will try again.');
          }
        }, remaining);
      }
      return;
    }

    // Tier upgrade path: session already claimed at 20-min tier, schedule/trigger 45-min upgrade
    if (activeGeofence.sessionRecorded && !activeGeofence.pointsPending && activeGeofence.sessionId && !activeGeofence.tierUpgraded) {
      const elapsed   = Date.now() - activeGeofence.entryTimestamp;
      const remaining = PROD_UPGRADE_MS - elapsed;
      if (remaining <= 0) {
        console.log('[Geofence] Foreground: already past 45-min mark — upgrading tier now.');
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, tierUpgraded: true }));
        await upgradeGymTier(activeGeofence.sessionId);
      } else {
        console.log(`[Geofence] Foreground: scheduling 45-min tier upgrade in ${Math.round(remaining / 1000)}s`);
        dwellTimerRef.current = setTimeout(async () => {
          dwellTimerRef.current = null;
          const raw2 = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
          if (!raw2) return;
          const gf: StoredGeofence = JSON.parse(raw2);
          if (gf.tierUpgraded || !gf.sessionId) return;
          console.log('[Geofence] Foreground: 45-min upgrade timer fired.');
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, tierUpgraded: true }));
          await upgradeGymTier(gf.sessionId);
        }, remaining);
      }
      return;
    }

    if (activeGeofence.sessionRecorded) return;

    const elapsed   = Date.now() - activeGeofence.entryTimestamp;
    const remaining = MIN_DWELL_MS - elapsed;

    if (remaining <= 0) {
      console.log('[Geofence] Foreground: dwell already met — recording session now.');
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true }));
      const { outcome, sessionId } = await recordDwellSession(activeGeofence);
      if (outcome === 'too_short') {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true, pointsPending: true }));
      } else if (outcome === 'claimed' && sessionId) {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true, sessionId }));
        try {
          const { notifySessionCompleted } = await import('@/lib/notifications');
          await notifySessionCompleted(activeGeofence.partnerName, sessionId);
        } catch (err) {
          console.warn('[Geofence] Session completed notification failed:', err);
        }
      }
      return;
    }

    console.log(`[Geofence] Foreground: dwell timer set for ${Math.round(remaining / 1000)}s`);
    dwellTimerRef.current = setTimeout(async () => {
      dwellTimerRef.current = null;
      const raw2 = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      if (!raw2) return; // user exited before timer — background task handles it
      const gf: StoredGeofence = JSON.parse(raw2);
      if (gf.sessionRecorded) return;
      console.log('[Geofence] Foreground: dwell timer fired — recording session.');
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true }));
      const { outcome, sessionId } = await recordDwellSession(gf);
      if (outcome === 'too_short') {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true, pointsPending: true }));
      } else if (outcome === 'claimed' && sessionId) {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true, sessionId }));
        try {
          const { notifySessionCompleted } = await import('@/lib/notifications');
          await notifySessionCompleted(gf.partnerName, sessionId);
        } catch (err) {
          console.warn('[Geofence] Session completed notification failed:', err);
        }
      }
    }, remaining);
  }, []);

  useEffect(() => {
    scheduleDwellTimer();
    const pollInterval = setInterval(scheduleDwellTimer, 10_000);
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        scheduleDwellTimer();
      } else {
        // App backgrounded — clear foreground timer; exit event is the fallback
        if (dwellTimerRef.current != null) {
          clearTimeout(dwellTimerRef.current);
          dwellTimerRef.current = null;
        }
      }
    });
    return () => {
      clearInterval(pollInterval);
      sub.remove();
      if (dwellTimerRef.current != null) clearTimeout(dwellTimerRef.current);
    };
  }, [scheduleDwellTimer]);

  // Fetch partners once on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reconcile partner circles when the app becomes active, and periodically while
  // the app stays open, so admin radius edits don't leave stale native regions behind.
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (AppState.currentState === 'active') {
        refresh();
      }
    }, 5 * 60 * 1000);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        refresh();
      }
    });

    return () => {
      clearInterval(refreshInterval);
      sub.remove();
    };
  }, [refresh]);

  // Start geofencing when partners load — never torn down by navigation
  useEffect(() => {
    if (!partners.length) return;

    // Restart native monitoring whenever the monitored circles change.
    const fingerprint = partners
      .map(p => `${p.id}:${p.lat.toFixed(6)}:${p.lng.toFixed(6)}:${p.geofenceRadius}`)
      .sort()
      .join(',');
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;

    async function startGeofencing() {
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return;

      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') {
        console.warn('[Geofence] Background location permission denied — geofencing inactive.');
        return;
      }

      const partnerMap: Record<string, string> = {};
      partners.forEach(p => { partnerMap[p.id] = p.name; });
      await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify(partnerMap));

      // iOS allows max 20 geofence regions; Android allows 100.
      // Sort by distance from current position and monitor only the 50 nearest.
      const MAX_REGIONS = 50;
      const userPos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const nearby = [...partners]
        .sort((a, b) =>
          haversineMetres(userPos.coords.latitude, userPos.coords.longitude, a.lat, a.lng) -
          haversineMetres(userPos.coords.latitude, userPos.coords.longitude, b.lat, b.lng)
        )
        .slice(0, MAX_REGIONS);

      const regions: Location.LocationRegion[] = nearby.map(p => ({
        identifier:    p.id,
        latitude:      p.lat,
        longitude:     p.lng,
        radius:        p.geofenceRadius,
        notifyOnEnter: true,
        notifyOnExit:  true,
      }));

      try {
        // To avoid internal sync issues in Expo Go, we check if the task is already registered.
        // If it is, we stop it first to ensure we're starting with a fresh set of regions.
        const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME);
        if (isRegistered) {
          await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
        }
      } catch {
        // If unregistration fails (e.g. because of TaskNotFoundException), we can safely ignore it
        // and proceed to (re)start the geofencing.
      }

      try {
        await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
        setIsMonitoring(true);
        console.log(`[Geofence] Monitoring ${regions.length} location(s).`);
      } catch (err) {
        console.error('[Geofence] Failed to start:', err);
      }

      // If the user is already inside a geofence when monitoring starts, record it
      try {
        const loc =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

        if (loc) {
          // Check if a gym session was already logged today before setting active state
          let gymLoggedToday = false;
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const { count } = await supabase
                .from('activity_sessions')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('type', 'gym')
                .gte('started_at', today.toISOString());
              gymLoggedToday = (count ?? 0) > 0;
            }
          } catch { /* non-fatal */ }

          for (const partner of partners) {
            const dist = haversineMetres(
              loc.coords.latitude, loc.coords.longitude,
              partner.lat, partner.lng,
            );
            if (dist <= partner.geofenceRadius) {
              if (gymLoggedToday) {
                console.log(`[Geofence] Already inside "${partner.name}" but gym session logged today — skipping.`);
              } else {
                const existing = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
                if (!existing) {
                  await AsyncStorage.setItem(
                    ACTIVE_GEOFENCE_KEY,
                    JSON.stringify({
                      partnerId:      partner.id,
                      partnerName:    partner.name,
                      entryTimestamp: Date.now(),
                      latitude:       partner.lat,
                      longitude:      partner.lng,
                      radius:         partner.geofenceRadius,
                    }),
                  );
                  console.log(`[Geofence] Already inside "${partner.name}" — active state set.`);
                }
              }
              break;
            }
          }
        }
      } catch { /* non-fatal — geofencing is still active */ }
    }

    startGeofencing();
    // No cleanup: geofencing must survive tab navigation and screen transitions
  }, [partners]);

  return (
    <GeofenceContext.Provider value={{ partners, isMonitoring, loading, refresh }}>
      {children}
    </GeofenceContext.Provider>
  );
}

export function useGeofenceContext(): GeofenceContextValue {
  return useContext(GeofenceContext);
}

// ─── Standalone name search (searches entire DB, not just nearby) ─────────────

export async function searchPartners(query: string): Promise<Partner[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('partners')
    .select('id, name, description, category, address, locations, logo_url, logo_bg, image1_url, image2_url, opening_hours')
    .eq('active', true)
    .ilike('name', `%${q}%`)
    .limit(200);
  if (error || !data) return [];
  return formatPartnerRows(data);
}
