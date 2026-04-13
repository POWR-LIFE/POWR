import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  area: string;
  pts: number;
  distance: string;
  logoText: string;
  logoUrl?: string;
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
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openMins  = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  return nowMins >= openMins && nowMins < closeMins;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GEOFENCE_TASK_NAME     = 'GEOFENCE_CHECK_IN';
const ACTIVE_GEOFENCE_KEY    = '@powr/active_geofence';
const PARTNER_MAP_KEY        = '@powr/partner_map';
const SESSION_COMPLETED_KEY  = '@powr/session_completed';

// ⚠️ DEV OVERRIDES — restore before release
const MIN_DWELL_MS = 30 * 1000; // production: 20 * 60 * 1000
const DEV_RADIUS_M: Record<string, number> = {
  'POWR Test Gym': 2,
};

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
      })
    );
    console.log(`[Geofence] Entered "${partnerName}"`);

  } else if (eventType === Location.GeofencingEventType.Exit) {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    const activeGeofence = raw ? JSON.parse(raw) : null;

    await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);

    if (!activeGeofence) return;

    const dwellMs = Date.now() - activeGeofence.entryTimestamp;

    if (dwellMs < MIN_DWELL_MS) {
      console.log(`[Geofence] Dwell ${Math.round(dwellMs / 60000)}min < 20min — no points.`);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const startedAt   = new Date(activeGeofence.entryTimestamp);
      const endedAt     = new Date();
      const durationSec = Math.round(dwellMs / 1000);

      const { getDeviceId } = await import('@/lib/device');
      const deviceId = await getDeviceId();

      // Insert with conflict handling — the DB unique index
      // (user_id, type, day) prevents duplicates even under race conditions.
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
          raw_gps:      {
            partnerId: activeGeofence.partnerId,
            partnerName: activeGeofence.partnerName,
            entryTimestamp: activeGeofence.entryTimestamp
          }
        })
        .select()
        .single();

      if (sessionError) {
        // Unique constraint violation → session already exists today
        if (sessionError.code === '23505') {
          console.log('[Geofence] Gym session already recorded today — skipping.');
          return;
        }
        console.error('[Geofence] Failed to create session:', sessionError);
        return;
      }
      if (!session) return;

      // Signal the foreground app that a session has completed so it can refresh.
      // Written before claim-points so the UI reacts immediately on exit.
      await AsyncStorage.setItem(
        SESSION_COMPLETED_KEY,
        JSON.stringify({
          partnerName: activeGeofence.partnerName,
          durationSec,
          timestamp:   Date.now(),
        }),
      );

      // Force-refresh the token — background tasks don't auto-refresh, so the
      // cached access token can be expired by the time the exit event fires.
      const { data: { session: authSession } } = await supabase.auth.refreshSession();
      if (!authSession?.access_token) {
        console.error('[Geofence] No valid session after refresh — cannot claim points.');
        return;
      }

      const { data: claimData, error: claimError } = await supabase.functions.invoke('claim-points', {
        body: { session_id: session.id },
      });

      if (claimError) {
        // Extract the actual response body for better diagnostics
        const body = await (claimError as any)?.context?.json?.().catch(() => null);
        console.error('[Geofence] Claim points error:', body ?? claimError.message);
      } else {
        console.log(`[Geofence] Points claimed after ${Math.round(dwellMs / 60000)}min dwell.`, claimData);
      }
    } catch (err) {
      console.error('[Geofence] Background task failed:', err);
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

// ─── Context ──────────────────────────────────────────────────────────────────

interface GeofenceContextValue {
  partners: Partner[];
  isMonitoring: boolean;
  loading: boolean;
}

const GeofenceContext = createContext<GeofenceContextValue>({
  partners: [],
  isMonitoring: false,
  loading: true,
});

export function GeofenceProvider({ children }: { children: React.ReactNode }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const fingerprintRef = useRef('');

  // Fetch partners once on mount
  useEffect(() => {
    async function fetchPartners() {
      try {
        // Try full schema; fall back if opening_hours/description columns don't exist yet
        let fetchResult: { data: any[] | null; error: any } = await supabase
          .from('partners')
          .select('id, name, description, category, locations, logo_url, image1_url, image2_url, opening_hours')
          .eq('active', true);

        if (fetchResult.error) {
          fetchResult = await supabase
            .from('partners')
            .select('id, name, category, locations, logo_url')
            .eq('active', true);
        }

        const { data, error } = fetchResult;
        if (error || !data) return;

        const formatted: Partner[] = [];
        data.forEach((p: any) => {
          if (!p.locations) return;
          const locs = Array.isArray(p.locations) ? p.locations : [p.locations];
          locs.forEach((loc: any, idx: number) => {
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
              area:           loc.name || 'Local',
              pts:            p.category.toLowerCase() === 'gym' ? 15 : 10,
              distance:       '',
              logoText:       logoText.length > 10 ? logoText.substring(0, 10) : logoText,
              logoUrl:        p.logo_url,
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

        setPartners(formatted);
      } finally {
        setLoading(false);
      }
    }

    fetchPartners();
  }, []);

  // Start geofencing when partners load — never torn down by navigation
  useEffect(() => {
    if (!partners.length) return;

    const fingerprint = partners.map(p => p.id).sort().join(',');
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

      const regions: Location.LocationRegion[] = partners.map(p => ({
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
      } catch (err) {
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
    <GeofenceContext.Provider value={{ partners, isMonitoring, loading }}>
      {children}
    </GeofenceContext.Provider>
  );
}

export function useGeofenceContext(): GeofenceContextValue {
  return useContext(GeofenceContext);
}
