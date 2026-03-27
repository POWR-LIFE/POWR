import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Partner {
  id: string;
  name: string;
  category: string;
  status: string;
  area: string;
  pts: number;
  distance: string;
  logoText: string;
  logoUrl?: string;
  logoLight: boolean;
  lat: number;
  lng: number;
  geofenceRadius: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GEOFENCE_TASK_NAME  = 'GEOFENCE_CHECK_IN';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const PARTNER_MAP_KEY     = '@powr/partner_map';

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
    const mapJson = await AsyncStorage.getItem(PARTNER_MAP_KEY);
    const partnerMap: Record<string, string> = mapJson ? JSON.parse(mapJson) : {};
    const partnerName = partnerMap[region.identifier] ?? region.identifier;

    await AsyncStorage.setItem(
      ACTIVE_GEOFENCE_KEY,
      JSON.stringify({
        partnerId:      region.identifier,
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

      // Dedup: the OS can fire Exit twice in quick succession — skip if already recorded
      const { count: existing } = await supabase
        .from('activity_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('started_at', startedAt.toISOString());

      if ((existing ?? 0) > 0) {
        console.log('[Geofence] Duplicate exit event — session already recorded, skipping.');
        return;
      }

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
        })
        .select()
        .single();

      if (sessionError || !session) {
        console.error('[Geofence] Failed to create session:', sessionError);
        return;
      }

      // Force-refresh the token — background tasks don't auto-refresh, so the
      // cached access token can be expired by the time the exit event fires.
      const { data: { session: authSession } } = await supabase.auth.refreshSession();
      if (!authSession?.access_token) {
        console.error('[Geofence] No valid session after refresh — cannot claim points.');
        return;
      }

      const { data: claimData, error: claimError } = await supabase.functions.invoke('claim-points', {
        body: { session_id: session.id },
        headers: { Authorization: `Bearer ${authSession.access_token}` },
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
        const { data, error } = await supabase
          .from('partners')
          .select('id, name, category, locations, logo_url')
          .eq('active', true);

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
            formatted.push({
              id:             `${p.id}-${idx}`,
              name:           p.name,
              category:       p.category.charAt(0).toUpperCase() + p.category.slice(1),
              status:         'Open now',
              area:           loc.name || 'Local',
              pts:            p.category.toLowerCase() === 'gym' ? 15 : 10,
              distance:       '',
              logoText:       logoText.length > 10 ? logoText.substring(0, 10) : logoText,
              logoUrl:        p.logo_url,
              logoLight:      p.category.toLowerCase() !== 'gym',
              lat:            loc.lat,
              lng:            loc.lng,
              geofenceRadius: DEV_RADIUS_M[p.name] ?? loc.radius ?? 50,
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
          for (const partner of partners) {
            const dist = haversineMetres(
              loc.coords.latitude, loc.coords.longitude,
              partner.lat, partner.lng,
            );
            if (dist <= partner.geofenceRadius) {
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
