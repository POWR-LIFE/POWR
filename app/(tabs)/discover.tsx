import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as RNImage,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileButton } from '@/components/ProfileButton';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { useGeofenceContext, type Partner, type Trainer, type DayKey, type OpeningHours } from '@/context/GeofenceContext';
import { supabase } from '@/lib/supabase';
import { GeometricBackground } from '@/components/home/GeometricBackground';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#1E1E1E';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Map config ───────────────────────────────────────────────────────────────

const MAP_HEIGHT = 320;

const DEFAULT_REGION = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

const DARK_MAP_STYLE = [
  { elementType: 'geometry',                                    stylers: [{ color: '#1c1c1e' }] },
  { elementType: 'labels.text.fill',                            stylers: [{ color: '#686868' }] },
  { elementType: 'labels.text.stroke',                          stylers: [{ color: '#161616' }] },
  { featureType: 'road',         elementType: 'geometry',       stylers: [{ color: '#282828' }] },
  { featureType: 'road',         elementType: 'geometry.stroke',stylers: [{ color: '#313131' }] },
  { featureType: 'road.highway', elementType: 'geometry',       stylers: [{ color: '#2e2e2e' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke',stylers: [{ color: '#383838' }] },
  { featureType: 'road',         elementType: 'labels.text.fill',stylers: [{ color: '#585858' }] },
  { featureType: 'water',        elementType: 'geometry',       stylers: [{ color: '#131314' }] },
  { featureType: 'water',        elementType: 'labels.text.fill',stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'poi',                                          stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',                                      stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry',     stylers: [{ color: '#272727' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#4e4e4e' }] },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = 'All' | 'Gym' | 'Yoga' | 'Pilates' | 'Cycling' | 'Running';
const CATEGORIES: Category[] = ['All', 'Gym', 'Yoga', 'Pilates', 'Cycling', 'Running'];

type SortMode = 'nearest' | 'pts' | 'az';
type RouteCoordinate = { latitude: number; longitude: number };
type RouteStep = {
  instruction: string;
  distanceText: string;
  durationText: string;
  endCoordinate?: RouteCoordinate;
};

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatHours(oh: OpeningHours | undefined): string {
  if (!oh) return 'Hours not listed';
  const now = new Date();
  const todayKey = DAY_KEYS[now.getDay()];
  const todayHours = oh[todayKey];
  if (!todayHours) return 'Closed today';
  return `Today ${todayHours.open} – ${todayHours.close}`;
}

function formatRouteEta(totalMinutes: number): string {
  const rounded = Math.max(1, Math.round(totalMinutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
}

function stripHtmlInstructions(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const navMapRef = useRef<MapView>(null);

  const [locationGranted, setLocationGranted] = useState(false);
  const [userLoc, setUserLoc] = useState<Location.LocationObject | null>(null);

  // Filter state
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [openNowFilter, setOpenNowFilter] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('nearest');
  const [maxDistanceMi, setMaxDistanceMi] = useState<number | null>(null); // null = any

  // UI state
  const [search, setSearch] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [routePartner, setRoutePartner] = useState<Partner | null>(null);
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<RouteCoordinate[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [routeStepsVisible, setRouteStepsVisible] = useState(false);
  const [routeStepsLoading, setRouteStepsLoading] = useState(false);
  const [walkingNavVisible, setWalkingNavVisible] = useState(false);
  const [isNavFollowing, setIsNavFollowing] = useState(true);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [mapLongitudeDelta, setMapLongitudeDelta] = useState(DEFAULT_REGION.longitudeDelta);

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [expandedTrainerId, setExpandedTrainerId] = useState<string | null>(null);

  const { partners: rawPartners, refresh: refreshPartners } = useGeofenceContext();
  const { activeGeofence } = useActiveGeofence();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshPartners();
    } finally {
      setRefreshing(false);
    }
  }, [refreshPartners]);

  // Fetch trainers when a gym partner is selected
  useEffect(() => {
    setExpandedTrainerId(null);
    if (!selectedPartner || selectedPartner.category.toLowerCase() !== 'gym') {
      setTrainers([]);
      return;
    }
    // partner id may have location suffix (e.g. "uuid-0"), extract base uuid
    const baseId = selectedPartner.id.replace(/-\d+$/, '');
    (async () => {
      const { data } = await supabase
        .from('trainers')
        .select('*')
        .eq('partner_id', baseId)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      setTrainers(data ?? []);
    })();
  }, [selectedPartner]);

  // Attach distances and sort
  const partners = useMemo(() => {
    const withDist = rawPartners.map(p => {
      if (!userLoc) return { ...p, _distMi: Infinity };
      const miles = getDistanceMiles(
        userLoc.coords.latitude, userLoc.coords.longitude, p.lat, p.lng,
      );
      return {
        ...p,
        distance: miles < 0.1 ? '< 0.1 mi' : `${miles.toFixed(1)} mi`,
        _distMi: miles,
      };
    });

    return [...withDist].sort((a, b) => {
      if (sortMode === 'nearest') return a._distMi - b._distMi;
      if (sortMode === 'pts') return b.pts - a.pts;
      return a.name.localeCompare(b.name);
    });
  }, [rawPartners, userLoc, sortMode]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setLocationGranted(true);
      let loc;
      try {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      } catch {
        loc = await Location.getLastKnownPositionAsync();
      }
      if (loc) {
        setUserLoc(loc);
        mapRef.current?.animateToRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }, 800);
      }
    })();
  }, []);

  // Apply all filters
  const filtered = useMemo(() => {
    let list = partners;
    if (activeCategory !== 'All') {
      list = list.filter(p => p.category.toLowerCase() === activeCategory.toLowerCase());
    }
    if (openNowFilter) {
      list = list.filter(p => p.isOpenNow);
    }
    if (maxDistanceMi !== null && userLoc) {
      list = list.filter(p => (p as any)._distMi <= maxDistanceMi);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) || p.area.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
      );
    }
    return list;
  }, [partners, activeCategory, openNowFilter, maxDistanceMi, search, userLoc]);

  const sortLabel = sortMode === 'nearest' ? 'Nearest' : sortMode === 'pts' ? 'Most Points' : 'A–Z';

  // Count active non-default filters for the badge
  const activeFilterCount = [
    maxDistanceMi !== null,
    activeCategory !== 'All',
  ].filter(Boolean).length;

  const fitMapToRoute = useCallback((coordinates: RouteCoordinate[]) => {
    if (!mapRef.current || coordinates.length === 0) return;
    mapRef.current.fitToCoordinates(coordinates, {
      edgePadding: {
        top: 88,
        right: 64,
        bottom: 88,
        left: 64,
      },
      animated: true,
    });
  }, []);

  const fitNavToOverview = useCallback(() => {
    if (!navMapRef.current || !routePartner) return;
    if (routeCoordinates.length > 0) {
      navMapRef.current.fitToCoordinates(routeCoordinates, {
        edgePadding: { top: 130, right: 54, bottom: 250, left: 54 },
        animated: true,
      });
      return;
    }
    const start = userLoc
      ? [{ latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude }]
      : [];
    const end = [{ latitude: routePartner.lat, longitude: routePartner.lng }];
    navMapRef.current.fitToCoordinates([...start, ...end], {
      edgePadding: { top: 130, right: 54, bottom: 250, left: 54 },
      animated: true,
    });
  }, [routeCoordinates, routePartner, userLoc]);

  useEffect(() => {
    if (!routePartner || !userLoc || !process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) {
      setRouteSteps([]);
      setRouteStepsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setRouteStepsLoading(true);
      try {
        const origin = `${userLoc.coords.latitude},${userLoc.coords.longitude}`;
        const destination = `${routePartner.lat},${routePartner.lng}`;
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=walking&key=${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (cancelled) return;

        const leg = data?.routes?.[0]?.legs?.[0];
        if (!leg) {
          setRouteSteps([]);
          return;
        }

        const steps = (leg.steps ?? []).map((step: any) => ({
          instruction: stripHtmlInstructions(step.html_instructions ?? ''),
          distanceText: step.distance?.text ?? '',
          durationText: step.duration?.text ?? '',
          endCoordinate: step.end_location
            ? {
                latitude: step.end_location.lat,
                longitude: step.end_location.lng,
              }
            : undefined,
        }));

        setRouteSteps(steps);

        if (!routeSummary && leg.distance?.value && leg.duration?.value) {
          setRouteSummary({
            distanceKm: leg.distance.value / 1000,
            durationMin: leg.duration.value / 60,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRouteSteps([]);
          console.error('Directions steps error:', error);
        }
      } finally {
        if (!cancelled) setRouteStepsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routePartner, userLoc, routeSummary]);

  const activeStepIndex = useMemo(() => {
    if (!userLoc || routeSteps.length === 0) return 0;
    for (let i = 0; i < routeSteps.length; i += 1) {
      const end = routeSteps[i].endCoordinate;
      if (!end) return i;
      const meters = getDistanceMeters(
        userLoc.coords.latitude,
        userLoc.coords.longitude,
        end.latitude,
        end.longitude,
      );
      if (meters > 20) return i;
    }
    return routeSteps.length - 1;
  }, [routeSteps, userLoc]);

  const activeStep = routeSteps[activeStepIndex] ?? null;

  useEffect(() => {
    if (!walkingNavVisible || !locationGranted) return;

    let isCancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 2,
          },
          (loc) => {
            if (isCancelled) return;
            setUserLoc(loc);
            if (!isNavFollowing) return;
            navMapRef.current?.animateCamera(
              {
                center: {
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                },
                zoom: 17,
                heading: loc.coords.heading && loc.coords.heading > 0 ? loc.coords.heading : 0,
                pitch: 50,
              },
              { duration: 700 }
            );
          }
        );
      } catch {
        // fallback to last known map state if tracking fails
      }
    })();

    return () => {
      isCancelled = true;
      if (subscription) subscription.remove();
    };
  }, [walkingNavVisible, locationGranted, isNavFollowing]);

  useEffect(() => {
    if (!walkingNavVisible || !userLoc || !navMapRef.current) return;
    setIsNavFollowing(true);
    navMapRef.current.animateCamera(
      {
        center: {
          latitude: userLoc.coords.latitude,
          longitude: userLoc.coords.longitude,
        },
        zoom: 17,
        heading: userLoc.coords.heading && userLoc.coords.heading > 0 ? userLoc.coords.heading : 0,
        pitch: 50,
      },
      { duration: 450 }
    );
  }, [walkingNavVisible, userLoc]);

  return (
    <View style={styles.screen}>
      <GeometricBackground />

      {/* ── Map ─────────────────────────────────────────────── */}
      <View style={[styles.mapContainer, { height: MAP_HEIGHT + insets.top }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          customMapStyle={Platform.OS === 'android' ? DARK_MAP_STYLE : undefined}
          userInterfaceStyle="dark"
          initialRegion={DEFAULT_REGION}
          showsUserLocation={locationGranted}
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={false}
          showsBuildings={false}
          showsIndoors={false}
          showsTraffic={false}
          rotateEnabled={false}
          pitchEnabled={false}
          onRegionChangeComplete={(r) => setMapLongitudeDelta(r.longitudeDelta)}
          onPress={() => {
            setRoutePartner(null);
            setRouteSummary(null);
            setRouteCoordinates([]);
            setRouteSteps([]);
            setRouteStepsVisible(false);
            setWalkingNavVisible(false);
          }}
        >
          {mapLongitudeDelta < 0.3 && filtered.map((partner) => (
            <React.Fragment key={partner.id}>
              <Marker
                coordinate={{ latitude: partner.lat, longitude: partner.lng }}
                title={partner.name}
                tracksViewChanges
              >
                <PartnerPin
                  partner={partner}
                  isActive={partner.id === activeGeofence?.partnerId}
                />
              </Marker>
            </React.Fragment>
          ))}

          {routePartner && userLoc && process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY && (
            <MapViewDirections
              origin={{ latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude }}
              destination={{ latitude: routePartner.lat, longitude: routePartner.lng }}
              apikey={process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}
              precision="high"
              strokeWidth={5}
              strokeColor={GOLD}
              mode="WALKING"
              resetOnChange={false}
              onReady={(result: { coordinates: RouteCoordinate[]; distance: number; duration: number }) => {
                setRouteSummary({ distanceKm: result.distance, durationMin: result.duration });
                setRouteCoordinates(result.coordinates);
                fitMapToRoute(result.coordinates);
              }}
              onError={(msg) => {
                setRouteSummary(null);
                setRouteCoordinates([]);
                setRouteSteps([]);
                console.error('Directions error:', msg);
              }}
            />
          )}
        </MapView>

        <View style={{ position: 'absolute', top: insets.top + 12, right: 16 }}>
          <ProfileButton />
        </View>

        {routePartner && (
          <View style={styles.routeOverlay}>
            <View style={styles.routeOverlayHeader}>
              <Text style={styles.routeOverlayTitle} numberOfLines={1}>{routePartner.name}</Text>
              <Text style={styles.routeOverlayMeta}>
                {routeSummary
                  ? `${formatRouteEta(routeSummary.durationMin)} • ${routeSummary.distanceKm.toFixed(1)} km`
                  : 'Loading walking route...'}
              </Text>
            </View>
            <View style={styles.routeOverlayActions}>
              <Pressable
                style={({ pressed }) => [styles.routeStartButton, pressed && styles.actionButtonPressed]}
                onPress={() => setWalkingNavVisible(true)}
              >
                <Ionicons name="navigate" size={14} color="#0d0d0d" />
                <Text style={styles.routeStartButtonText}>Start Walk</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.routeClearButton, pressed && { opacity: 0.75 }]}
                onPress={() => {
                  setRoutePartner(null);
                  setRouteSummary(null);
                  setRouteCoordinates([]);
                  setRouteSteps([]);
                  setRouteStepsVisible(false);
                  setWalkingNavVisible(false);
                }}
              >
                <Text style={styles.routeClearButtonText}>Clear</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* ── List + filters ───────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#E8D200"
            colors={['#E8D200']}
          />
        }
      >
        {/* Filter chips */}
        <View style={styles.filterRow}>
          <FilterChip
            label="Open Now"
            active={openNowFilter}
            onPress={() => setOpenNowFilter(v => !v)}
          />
          <Pressable
            style={({ pressed }) => [styles.filterChip, pressed && { opacity: 0.75 }]}
            onPress={() => setSortMenuVisible(true)}
          >
            <Text style={styles.filterChipText}>{sortLabel}</Text>
            <Text style={styles.filterChipTrailing}>▾</Text>
          </Pressable>
          <FilterChip
            label="Filters"
            active={activeFilterCount > 0}
            onPress={() => setFiltersVisible(true)}
            icon="options-outline"
            badge={activeFilterCount > 0 ? activeFilterCount : undefined}
          />
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search gyms, classes..."
            placeholderTextColor={MUTED}
            value={search}
            onChangeText={setSearch}
          />
          <Ionicons name="search-outline" size={16} color={MUTED} />
        </View>

        <View style={styles.catTabBar}>
          {CATEGORIES.map((cat) => {
            const active = cat === activeCategory;
            return (
              <Pressable
                key={cat}
                style={styles.catTab}
                onPress={() => setActiveCategory(cat)}
              >
                <Text style={[styles.catTabLabel, active && styles.catTabLabelActive]}>
                  {cat.toUpperCase()}
                </Text>
                {active && <View style={styles.catTabIndicator} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>
          {filtered.length} PARTNER{filtered.length !== 1 ? 'S' : ''} · {sortLabel.toUpperCase()}
        </Text>

        {filtered.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={32} color={MUTED} />
            <Text style={styles.emptyText}>No partners match your filters</Text>
            <Pressable onPress={() => {
              setOpenNowFilter(false);
              setActiveCategory('All');
              setMaxDistanceMi(null);
              setSearch('');
            }}>
              <Text style={styles.emptyReset}>Clear filters</Text>
            </Pressable>
          </View>
        )}

        {filtered.map((partner) => (
          <PartnerListRow
            key={partner.id}
            partner={partner}
            isActive={partner.id === activeGeofence?.partnerId}
            onPress={() => {
              setRoutePartner(null);
              setRouteSummary(null);
              setRouteCoordinates([]);
              setRouteSteps([]);
              setRouteStepsVisible(false);
              setWalkingNavVisible(false);
              mapRef.current?.animateCamera(
                {
                  center: { latitude: partner.lat, longitude: partner.lng },
                  zoom: 16,
                },
                { duration: 450 }
              );
              setSelectedPartner(partner);
            }}
          />
        ))}

        <View style={styles.comingSoonRow}>
          <View style={styles.comingSoonIcon}>
            <Text style={styles.comingSoonPlus}>+</Text>
          </View>
          <View style={styles.comingSoonInfo}>
            <Text style={styles.comingSoonTitle}>More coming soon</Text>
            <Text style={styles.comingSoonSub}>
              Expanding across London. New partners added regularly.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Partner detail modal ─────────────────────────────── */}
      <Modal
        visible={!!selectedPartner}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedPartner(null)}
      >
        <View style={styles.partnerModalOverlay}>
          {/* Tap-through spacer keeps the map visible and dismisses on tap */}
          <Pressable
            style={{ height: MAP_HEIGHT + insets.top - 80 }}
            onPress={() => setSelectedPartner(null)}
          />
          <View
            style={[
              styles.modalContent,
              styles.partnerModalContent,
              { paddingBottom: Math.max(insets.bottom, 24), overflow: 'hidden' },
            ]}
          >
            <GeometricBackground />
            {selectedPartner && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {/* Full-bleed hero */}
                <View style={styles.modalHero}>
                  {selectedPartner.image1Url ? (
                    <Image source={{ uri: selectedPartner.image1Url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                  ) : selectedPartner.image2Url ? (
                    <Image source={{ uri: selectedPartner.image2Url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                  ) : (
                    <View style={styles.modalHeroPlaceholder}>
                      <Ionicons name="fitness-outline" size={40} color="rgba(255,255,255,0.08)" />
                    </View>
                  )}

                  {/* Top-to-bottom fade for legibility */}
                  <LinearGradient
                    colors={['rgba(18,18,18,0.55)', 'rgba(18,18,18,0)', 'rgba(18,18,18,0.95)']}
                    locations={[0, 0.35, 1]}
                    style={StyleSheet.absoluteFillObject}
                    pointerEvents="none"
                  />

                  {/* Handle */}
                  <View style={styles.modalHeroHandle} />

                  {/* Close button */}
                  <Pressable onPress={() => setSelectedPartner(null)} style={styles.modalHeroClose}>
                    <Ionicons name="close" size={18} color="rgba(255,255,255,0.9)" />
                  </Pressable>

                  {/* Category badge top-left */}
                  <View style={styles.modalHeroBadge}>
                    <View style={[styles.modalStatusDot, selectedPartner.isOpenNow ? styles.modalStatusOpen : styles.modalStatusClosed]} />
                    <Text style={styles.modalHeroBadgeText}>
                      {selectedPartner.isOpenNow ? 'Open' : 'Closed'} · {selectedPartner.category}
                    </Text>
                  </View>

                  {/* Overlay: logo + name pinned to bottom of hero */}
                  <View style={styles.modalHeroFooter}>
                    <View style={styles.modalLogoCard}>
                      {selectedPartner.logoUrl ? (
                        <Image source={{ uri: selectedPartner.logoUrl }} style={styles.modalLogoImg} contentFit="contain" />
                      ) : (
                        <Text
                          style={[styles.modalLogoFallback, selectedPartner.logoLight && { color: '#1a1a1a' }]}
                          numberOfLines={2}
                          adjustsFontSizeToFit
                        >
                          {selectedPartner.logoText}
                        </Text>
                      )}
                    </View>
                    <View style={styles.modalHeroTitleWrap}>
                      <Text style={styles.modalPartnerName} numberOfLines={1} adjustsFontSizeToFit>{selectedPartner.name}</Text>
                      <Text style={styles.modalHeroArea} numberOfLines={1}>{selectedPartner.area}</Text>
                    </View>
                  </View>
                </View>

                {/* Info row: stacked details + reward pills */}
                <View style={styles.infoRow}>
                  <View style={styles.infoDetails}>
                    <View style={styles.modalDetailItem}>
                      <Ionicons name="time-outline" size={13} color={DIM} />
                      <Text style={styles.modalDetailText}>{formatHours(selectedPartner.openingHours)}</Text>
                    </View>
                    <View style={styles.modalDetailItem}>
                      <Ionicons name="location-sharp" size={13} color={DIM} />
                      <Text style={styles.modalDetailText}>{selectedPartner.distance} · {selectedPartner.area}</Text>
                    </View>
                  </View>
                  <View style={styles.infoPills}>
                    <View style={styles.rewardPill}>
                      <Ionicons name="flash" size={10} color={GOLD} />
                      <Text style={styles.rewardPillText}>+{selectedPartner.pts}</Text>
                    </View>
                  </View>
                </View>

                {/* Body */}
                <View style={styles.modalBody}>
                  {selectedPartner.description ? (
                    <Text style={styles.description}>{selectedPartner.description}</Text>
                  ) : null}

                  {/* Trainers */}
                  {trainers.length > 0 && (
                    <View style={styles.trainersSection}>
                      <View style={styles.trainersDivider} />
                      <Text style={styles.trainersSectionTitle}>Personal Trainers</Text>
                      {trainers.map(t => (
                        <TrainerCard
                          key={t.id}
                          trainer={t}
                          expanded={expandedTrainerId === t.id}
                          onToggle={() => {
                            LayoutAnimation.configureNext(
                              LayoutAnimation.create(260, 'easeInEaseOut', 'opacity'),
                            );
                            setExpandedTrainerId(prev => (prev === t.id ? null : t.id));
                          }}
                        />
                      ))}
                    </View>
                  )}

                  <Pressable
                    style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                    onPress={() => {
                      const start = userLoc
                        ? [{ latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude }]
                        : [];
                      const end = [{ latitude: selectedPartner.lat, longitude: selectedPartner.lng }];
                      fitMapToRoute([...start, ...end]);
                      setRouteSummary(null);
                      setRouteCoordinates([]);
                      setRouteSteps([]);
                      setRoutePartner(selectedPartner);
                      setWalkingNavVisible(true);
                      setSelectedPartner(null);
                    }}
                  >
                    <Ionicons name="navigate" size={18} color="#0d0d0d" />
                    <Text style={styles.actionButtonText}>Get Directions</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Full-screen walking nav ────────────────────────── */}
      <Modal
        visible={walkingNavVisible && !!routePartner}
        animationType="slide"
        onRequestClose={() => setWalkingNavVisible(false)}
      >
        <View style={styles.walkNavScreen}>
          <MapView
            ref={navMapRef}
            style={StyleSheet.absoluteFillObject}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            customMapStyle={Platform.OS === 'android' ? DARK_MAP_STYLE : undefined}
            userInterfaceStyle="dark"
            initialRegion={DEFAULT_REGION}
            showsUserLocation
            followsUserLocation={false}
            showsMyLocationButton={false}
            showsCompass={false}
            showsTraffic={false}
            rotateEnabled
            pitchEnabled
            onPanDrag={() => setIsNavFollowing(false)}
          >
            {routePartner && (
              <Marker
                coordinate={{ latitude: routePartner.lat, longitude: routePartner.lng }}
                title={routePartner.name}
              >
                <PartnerPin partner={routePartner} />
              </Marker>
            )}

            {routeCoordinates.length > 1 && (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor={GOLD}
                strokeWidth={6}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </MapView>

          <View style={[styles.walkNavTopBar, { paddingTop: insets.top + 8 }]}> 
            <Pressable
              style={({ pressed }) => [styles.walkNavIconButton, pressed && { opacity: 0.8 }]}
              onPress={() => setWalkingNavVisible(false)}
            >
              <Ionicons name="chevron-back" size={20} color={TEXT} />
            </Pressable>
            <View style={styles.walkNavSummary}>
              <Text style={styles.walkNavTitle} numberOfLines={1}>{routePartner?.name ?? 'Route'}</Text>
              <Text style={styles.walkNavMeta}>
                {routeSummary
                  ? `${formatRouteEta(routeSummary.durationMin)} • ${routeSummary.distanceKm.toFixed(1)} km walk`
                  : 'Walking route'}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.walkNavIconButton, pressed && { opacity: 0.8 }]}
              onPress={() => setRouteStepsVisible(true)}
            >
              <Ionicons name="list" size={18} color={TEXT} />
            </Pressable>
          </View>

          {activeStep && (
            <View style={[styles.nextStepCard, { top: insets.top + 64 }]}>
              <Text style={styles.nextStepLabel}>Next</Text>
              <Text style={styles.nextStepInstruction} numberOfLines={2}>{activeStep.instruction}</Text>
              <Text style={styles.nextStepMeta}>{activeStep.distanceText} • {activeStep.durationText}</Text>
            </View>
          )}

          <View style={[styles.walkNavBottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}> 
            <Pressable
              style={({ pressed }) => [styles.routeStartButton, pressed && styles.actionButtonPressed]}
              onPress={() => {
                if (!userLoc) return;
                setIsNavFollowing(true);
                navMapRef.current?.animateCamera(
                  {
                    center: {
                      latitude: userLoc.coords.latitude,
                      longitude: userLoc.coords.longitude,
                    },
                    zoom: 17,
                    heading: userLoc.coords.heading && userLoc.coords.heading > 0 ? userLoc.coords.heading : 0,
                    pitch: 50,
                  },
                  { duration: 500 }
                );
              }}
            >
              <Ionicons name="locate" size={14} color="#0d0d0d" />
              <Text style={styles.routeStartButtonText}>Recenter</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.routeClearButton, pressed && { opacity: 0.75 }]}
              onPress={() => {
                setIsNavFollowing(false);
                fitNavToOverview();
              }}
            >
              <Text style={styles.routeClearButtonText}>Overview</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.routeClearButton, pressed && { opacity: 0.75 }]}
              onPress={() => {
                setWalkingNavVisible(false);
                setRoutePartner(null);
                setRouteSummary(null);
                setRouteCoordinates([]);
                setRouteSteps([]);
                setRouteStepsVisible(false);
              }}
            >
              <Text style={styles.routeClearButtonText}>End Route</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── In-app directions steps ────────────────────────── */}
      <Modal
        visible={routeStepsVisible && !!routePartner}
        animationType="slide"
        transparent
        onRequestClose={() => setRouteStepsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setRouteStepsVisible(false)} />
          <View style={[styles.stepsSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.sortTitle}>Walking Directions</Text>
            {routePartner && (
              <Text style={styles.stepsDestination} numberOfLines={1}>To {routePartner.name}</Text>
            )}
            <ScrollView
              style={styles.stepsScroll}
              contentContainerStyle={styles.stepsScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {routeStepsLoading ? (
                <Text style={styles.stepsLoadingText}>Loading route steps...</Text>
              ) : routeSteps.length === 0 ? (
                <Text style={styles.stepsLoadingText}>No detailed steps available yet.</Text>
              ) : (
                routeSteps.map((step, index) => (
                  <View
                    key={`${step.instruction}-${index}`}
                    style={[styles.stepRow, index === activeStepIndex && styles.stepRowActive]}
                  >
                    <View style={styles.stepIndexBubble}>
                      <Text style={styles.stepIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={styles.stepInstruction}>{step.instruction}</Text>
                      <Text style={styles.stepMeta}>{step.distanceText} · {step.durationText}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <Pressable
              style={[styles.actionButton, { marginTop: 12 }]}
              onPress={() => setRouteStepsVisible(false)}
            >
              <Text style={styles.actionButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Sort menu ────────────────────────────────────────── */}
      <Modal
        visible={sortMenuVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSortMenuVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSortMenuVisible(false)}>
          <View style={[styles.sortSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.sortTitle}>Sort by</Text>
            {([
              { key: 'nearest', label: 'Nearest', icon: 'location-outline' },
              { key: 'pts',     label: 'Most Points', icon: 'star-outline' },
              { key: 'az',      label: 'A–Z', icon: 'text-outline' },
            ] as { key: SortMode; label: string; icon: string }[]).map(opt => (
              <Pressable
                key={opt.key}
                style={({ pressed }) => [
                  styles.sortOption,
                  sortMode === opt.key && styles.sortOptionActive,
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => { setSortMode(opt.key); setSortMenuVisible(false); }}
              >
                <Ionicons name={opt.icon as any} size={18} color={sortMode === opt.key ? GOLD : DIM} />
                <Text style={[styles.sortOptionText, sortMode === opt.key && styles.sortOptionTextActive]}>
                  {opt.label}
                </Text>
                {sortMode === opt.key && <Ionicons name="checkmark" size={16} color={GOLD} style={{ marginLeft: 'auto' }} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Filters sheet ────────────────────────────────────── */}
      <Modal
        visible={filtersVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFiltersVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFiltersVisible(false)}>
          <Pressable style={[styles.filtersSheet, { paddingBottom: Math.max(insets.bottom, 24) }]} onPress={e => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <View style={styles.filtersHeader}>
              <Text style={styles.sortTitle}>Filters</Text>
              <Pressable onPress={() => {
                setActiveCategory('All');
                setMaxDistanceMi(null);
              }}>
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>
            </View>

            {/* Category */}
            <Text style={styles.filterSectionLabel}>CATEGORY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {CATEGORIES.map(cat => {
                const active = cat === activeCategory;
                return (
                  <Pressable
                    key={cat}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    onPress={() => setActiveCategory(cat)}
                  >
                    <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{cat}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Max distance */}
            <Text style={[styles.filterSectionLabel, { marginTop: 20 }]}>MAX DISTANCE</Text>
            <View style={styles.distanceRow}>
              {([null, 1, 5, 10, 25] as (number | null)[]).map(d => {
                const active = maxDistanceMi === d;
                return (
                  <Pressable
                    key={String(d)}
                    style={[styles.distanceChip, active && styles.distanceChipActive]}
                    onPress={() => setMaxDistanceMi(d)}
                  >
                    <Text style={[styles.distanceChipText, active && styles.distanceChipTextActive]}>
                      {d === null ? 'Any' : `${d} mi`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={[styles.actionButton, { marginTop: 24 }]}
              onPress={() => setFiltersVisible(false)}
            >
              <Text style={styles.actionButtonText}>
                Show {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PartnerPin({ partner, isActive }: { partner: Partner; isActive?: boolean }) {
  return (
    <View style={[styles.pinCircle, partner.logoLight && styles.pinCircleLight, isActive && styles.pinCircleActive]}>
      {partner.logoUrl ? (
        <RNImage source={{ uri: partner.logoUrl }} style={styles.pinLogoImage} resizeMode="contain" />
      ) : (
        <Text style={[styles.pinLogoFallback, partner.logoLight && { color: '#000' }]} numberOfLines={1}>
          {partner.logoText.split('\n')[0]}
        </Text>
      )}
    </View>
  );
}

function PartnerListRow({
  partner, isActive, onPress,
}: {
  partner: Partner; isActive?: boolean; onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.partnerRow,
        isActive && styles.partnerRowActive,
        pressed && { opacity: 0.92 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.logoBox, partner.logoLight && styles.logoBoxLight]}>
        {partner.logoUrl ? (
          <Image source={{ uri: partner.logoUrl }} style={styles.logoImage} contentFit="contain" />
        ) : (
          <Text style={[styles.logoText, partner.logoLight && styles.logoTextDark]} numberOfLines={2} adjustsFontSizeToFit>
            {partner.logoText}
          </Text>
        )}
      </View>
      <View style={styles.partnerInfo}>
        <Text
          style={[styles.partnerName, isActive && { color: GOLD }]}
          numberOfLines={1}
        >
          {partner.name}
        </Text>
        <Text style={styles.partnerMeta} numberOfLines={1}>
          {isActive ? 'Session active' : partner.isOpenNow ? 'Open now' : 'Closed'} · {partner.area}
        </Text>
      </View>
      <View style={styles.partnerRight}>
        <Text style={styles.partnerDistanceNum}>{partner.distance}</Text>
        <Ionicons name="chevron-forward" size={14} color={DIM} style={{ marginTop: 2 }} />
      </View>
    </Pressable>
  );
}

function TrainerCard({
  trainer, expanded, onToggle,
}: {
  trainer: Trainer; expanded: boolean; onToggle: () => void;
}) {
  const hasProfile = !!trainer.profile_url;
  const hasBooking = !!trainer.booking_url;

  const openUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
    } catch {
      // swallow — nothing actionable to show the user
    }
  };

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.trainerCardWrap,
        expanded && styles.trainerCardWrapExpanded,
        pressed && { opacity: 0.96 },
      ]}
    >
      {/* Collapsed header row — hidden when expanded */}
      {!expanded && (
        <View style={styles.trainerCard}>
          <View style={styles.trainerPhotoRing}>
            <View style={styles.trainerPhoto}>
              {trainer.photo_url ? (
                <Image source={{ uri: trainer.photo_url }} style={styles.trainerPhotoImg} contentFit="cover" />
              ) : (
                <Ionicons name="person-outline" size={26} color="rgba(255,255,255,0.12)" />
              )}
            </View>
          </View>
          <View style={styles.trainerInfo}>
            <Text style={styles.trainerName} numberOfLines={1}>{trainer.name}</Text>
            {trainer.experience ? (
              <Text style={styles.trainerExperience}>{trainer.experience}</Text>
            ) : null}
            {trainer.bio ? (
              <Text style={styles.trainerBio} numberOfLines={2}>{trainer.bio}</Text>
            ) : null}
          </View>
          <Ionicons name="chevron-down" size={16} color={DIM} style={styles.trainerChevron} />
        </View>
      )}

      {/* Expanded details */}
      {expanded && (
        <View style={styles.trainerExpanded}>
          <View style={styles.trainerPhotoRingExpanded}>
            <View style={styles.trainerPhotoExpanded}>
              {trainer.photo_url ? (
                <Image source={{ uri: trainer.photo_url }} style={styles.trainerPhotoImgExpanded} contentFit="cover" />
              ) : (
                <Ionicons name="person-outline" size={40} color="rgba(255,255,255,0.12)" />
              )}
            </View>
          </View>
          <Pressable onPress={onToggle} hitSlop={8} style={styles.trainerCollapseBtn}>
            <Ionicons name="chevron-up" size={16} color={GOLD} />
          </Pressable>
          <Text style={styles.trainerNameLarge} numberOfLines={1} adjustsFontSizeToFit>{trainer.name}</Text>
          {trainer.experience ? (
            <View style={styles.trainerExperienceRow}>
              <Ionicons name="ribbon-outline" size={12} color={GOLD} />
              <Text style={styles.trainerExperienceLarge}>{trainer.experience}</Text>
            </View>
          ) : null}

          {trainer.specialties && trainer.specialties.length > 0 && (
            <View style={styles.trainerChipsWrap}>
              {trainer.specialties.map(s => (
                <View key={s} style={styles.trainerChip}>
                  <Text style={styles.trainerChipText}>{s}</Text>
                </View>
              ))}
            </View>
          )}

          {trainer.bio ? (
            <Text style={styles.trainerBioFull}>{trainer.bio}</Text>
          ) : null}

          {(hasProfile || hasBooking) && (
            <View style={styles.trainerActionsRow}>
              {hasBooking && (
                <Pressable
                  onPress={() => openUrl(trainer.booking_url!)}
                  style={({ pressed }) => [
                    styles.trainerBookBtn,
                    pressed && styles.actionButtonPressed,
                  ]}
                >
                  <Ionicons name="calendar" size={15} color="#0d0d0d" />
                  <Text style={styles.trainerBookBtnText}>Book Session</Text>
                </Pressable>
              )}
              {hasProfile && (
                <Pressable
                  onPress={() => openUrl(trainer.profile_url!)}
                  style={({ pressed }) => [
                    styles.trainerProfileBtn,
                    !hasBooking && { flex: 1 },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons name="open-outline" size={14} color={TEXT} />
                  <Text style={styles.trainerProfileBtnText}>View Profile</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function FilterChip({
  label, active, icon, onPress, badge,
}: {
  label: string; active?: boolean; icon?: string; onPress: () => void; badge?: number;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && { opacity: 0.75 },
      ]}
      onPress={onPress}
    >
      {icon && <Ionicons name={icon as any} size={13} color={active ? '#0a0a0a' : DIM} />}
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
      {badge !== undefined && badge > 0 && (
        <View style={styles.filterBadge}>
          <Text style={styles.filterBadgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  mapContainer: { width: '100%', overflow: 'hidden' },

  walkNavScreen: {
    flex: 1,
    backgroundColor: BG,
  },
  walkNavTopBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walkNavSummary: {
    flex: 1,
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
  },
  walkNavIconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkNavTitle: { fontSize: 13, fontWeight: '500', color: TEXT },
  walkNavMeta: { fontSize: 11, fontWeight: '300', color: DIM },
  walkNavBottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nextStepCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(10,10,10,0.9)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  nextStepLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: GOLD,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  nextStepInstruction: { fontSize: 13, fontWeight: '500', color: TEXT, lineHeight: 18 },
  nextStepMeta: { fontSize: 11, fontWeight: '300', color: DIM },

  routeOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(15,15,15,0.92)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeOverlayHeader: { flex: 1, gap: 2 },
  routeOverlayTitle: { fontSize: 13, fontWeight: '500', color: TEXT },
  routeOverlayMeta: { fontSize: 11, fontWeight: '300', color: DIM },
  routeOverlayActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: GOLD,
  },
  routeStartButtonText: { fontSize: 12, fontWeight: '600', color: '#0d0d0d' },
  routeClearButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeClearButtonText: { fontSize: 12, fontWeight: '500', color: TEXT },

  stepsSheet: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    height: '72%',
  },
  stepsDestination: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    marginTop: -10,
    marginBottom: 14,
  },
  stepsScroll: { flex: 1 },
  stepsScrollContent: { gap: 10, paddingBottom: 8, flexGrow: 1 },
  stepsLoadingText: { fontSize: 13, color: DIM, fontWeight: '300', paddingVertical: 12 },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: CARD_BG,
  },
  stepRowActive: {
    borderColor: 'rgba(232,210,0,0.65)',
    backgroundColor: 'rgba(232,210,0,0.10)',
  },
  stepIndexBubble: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(232,210,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepIndexText: { fontSize: 11, fontWeight: '700', color: GOLD },
  stepBody: { flex: 1, gap: 4 },
  stepInstruction: { fontSize: 13, fontWeight: '400', color: TEXT, lineHeight: 18 },
  stepMeta: { fontSize: 11, fontWeight: '300', color: DIM },

  pinCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0d0d0d', borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 5, overflow: 'hidden',
  },
  pinCircleLight: { backgroundColor: '#F2F2F2' },
  pinCircleActive: { borderColor: GOLD, borderWidth: 2.5 },
  pinLogoImage: { width: '100%', height: '100%' },
  pinLogoFallback: { fontSize: 8, fontWeight: '700', color: '#fff', textAlign: 'center' },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, gap: 10, paddingTop: 14 },

  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG,
  },
  filterChipActive: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.8)' },
  filterChipText: { fontSize: 12, fontWeight: '400', color: DIM },
  filterChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  filterChipTrailing: { fontSize: 10, color: DIM },
  filterBadge: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { fontSize: 9, fontWeight: '700', color: GOLD },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent',
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '300', color: TEXT, padding: 0 },

  catTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    marginTop: 4,
    marginBottom: 8,
  },
  catTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    position: 'relative',
  },
  catTabLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.5)',
  },
  catTabLabelActive: {
    color: '#FFFFFF',
  },
  catTabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: '20%',
    right: '20%',
    height: 1.5,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },

  sectionLabel: {
    fontSize: 9, fontWeight: '500', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', paddingLeft: 2,
  },

  emptyState: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, color: DIM, fontWeight: '300' },
  emptyReset: { fontSize: 13, color: GOLD, fontWeight: '500', marginTop: 4 },

  partnerRow: {
    backgroundColor: 'transparent',
    paddingVertical: 14, paddingHorizontal: 4,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  partnerRowActive: {
    backgroundColor: 'rgba(232,210,0,0.04)',
  },
  logoBox: {
    width: 56, height: 56,
    backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
  },
  logoBoxLight: {},
  logoText: { fontSize: 12, fontWeight: '700', color: DIM, textAlign: 'center' },
  logoTextDark: { color: '#1a1a1a' },
  partnerInfo: { flex: 1, gap: 3 },
  partnerName: { fontSize: 15, fontWeight: '400', color: TEXT, letterSpacing: -0.1 },
  partnerMeta: { fontSize: 11, fontWeight: '300', color: DIM },
  partnerValueInline: {
    fontSize: 10, fontWeight: '500', color: GOLD, opacity: 0.8,
    marginTop: 3, letterSpacing: 0.3,
  },
  partnerRight: { alignItems: 'center', flexShrink: 0, minWidth: 52 },
  partnerDistanceNum: {
    fontSize: 13, fontWeight: '400', color: TEXT, letterSpacing: -0.2,
  },
  logoImage: { width: '78%', height: '78%' },

  comingSoonRow: {
    backgroundColor: 'transparent',
    paddingVertical: 14, paddingHorizontal: 4,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginTop: 4,
  },
  comingSoonIcon: {
    width: 56, height: 56, borderRadius: 14,
    backgroundColor: 'rgba(232,210,0,0.08)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.20)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  comingSoonPlus: { fontSize: 22, fontWeight: '200', color: GOLD },
  comingSoonInfo: { flex: 1, gap: 3 },
  comingSoonTitle: { fontSize: 14, fontWeight: '300', color: TEXT },
  comingSoonSub: { fontSize: 11, fontWeight: '300', color: DIM },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalHandle: { width: 40, height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },

  // Partner detail modal
  partnerModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  partnerModalContent: {
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  modalHero: {
    height: 260,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  modalHeroPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  modalHeroHandle: {
    position: 'absolute', top: 10, alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  modalHeroClose: {
    position: 'absolute', top: 14, right: 14,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  modalHeroBadge: {
    position: 'absolute', top: 18, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalHeroBadgeText: { fontSize: 11, color: TEXT, fontWeight: '400', letterSpacing: 0.3 },
  modalHeroFooter: {
    position: 'absolute', left: 16, right: 16, bottom: 14,
    flexDirection: 'row', alignItems: 'flex-end', gap: 12,
  },
  modalHeroTitleWrap: { flex: 1, gap: 2, paddingBottom: 4 },
  modalHeroArea: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '300' },
  modalLogoCard: {
    width: 72, height: 72, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', padding: 8,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  modalLogoImg: { width: '100%', height: '100%' },
  modalLogoFallback: {
    fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.6)',
    textAlign: 'center', letterSpacing: 0.5,
  },
  modalPartnerName: { fontSize: 22, fontWeight: '500', color: TEXT, letterSpacing: -0.2 },
  modalStatusDot: { width: 6, height: 6, borderRadius: 3 },
  modalStatusOpen: { backgroundColor: '#4ade80' },
  modalStatusClosed: { backgroundColor: '#f87171' },

  // Info row under hero
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, gap: 16,
  },
  infoDetails: { flex: 1, gap: 8, justifyContent: 'center' },
  infoPills: { gap: 6, alignItems: 'stretch' },
  modalDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalDetailText: { fontSize: 13, color: DIM, fontWeight: '300' },

  rewardPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'transparent', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GOLD,
    minWidth: 58,
  },
  rewardPillText: { fontSize: 13, color: GOLD, fontWeight: '600' },

  modalBody: { gap: 16, paddingBottom: 16, paddingHorizontal: 20, paddingTop: 18 },

  description: { fontSize: 13, color: DIM, lineHeight: 19, fontWeight: '300' },

  // Trainer cards
  trainersSection: { gap: 12, marginTop: 12 },
  trainersDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 4,
  },
  trainersSectionTitle: {
    fontSize: 13, fontWeight: '300', letterSpacing: 1.5, color: MUTED,
    textTransform: 'uppercase', marginBottom: 4,
  },
  trainerCardWrap: {
    borderRadius: 18,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  trainerCardWrapExpanded: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 12,
    marginVertical: 4,
  },
  trainerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 8,
  },
  trainerPhotoRing: {
    width: 68, height: 68, borderRadius: 34,
    borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    overflow: 'hidden',
  },
  trainerPhotoRingExpanded: {
    width: 110, height: 110, borderRadius: 55,
    borderColor: GOLD, borderWidth: 2,
  },
  trainerPhoto: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  trainerPhotoExpanded: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  trainerPhotoImg: { ...StyleSheet.absoluteFillObject, borderRadius: 34 },
  trainerPhotoImgExpanded: { ...StyleSheet.absoluteFillObject, borderRadius: 55 },
  trainerChevron: { marginLeft: 8, flexShrink: 0 },
  trainerInfo: { flex: 1, gap: 5, paddingTop: 2 },
  trainerName: { flexShrink: 1, fontSize: 16, fontWeight: '500', color: TEXT, letterSpacing: 0.2 },
  trainerExperience: { fontSize: 12, fontWeight: '300', color: DIM },
  trainerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  trainerChipsInline: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  trainerChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: 'rgba(232,210,0,0.08)',
  },
  trainerChipText: { fontSize: 11, fontWeight: '500', color: GOLD },
  trainerBio: { fontSize: 13, fontWeight: '300', color: DIM, lineHeight: 19, marginTop: 3 },

  // Expanded trainer card
  trainerExpanded: {
    marginTop: 4,
    gap: 10,
    alignItems: 'center',
    position: 'relative',
  },
  trainerCollapseBtn: {
    position: 'absolute', top: 0, right: 0,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  trainerNameLarge: {
    fontSize: 20, fontWeight: '600', color: TEXT, letterSpacing: -0.2,
    textAlign: 'center',
  },
  trainerExperienceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
  },
  trainerExperienceLarge: {
    fontSize: 12, fontWeight: '500', color: GOLD, letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  trainerChipsWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    justifyContent: 'center',
    marginTop: 2,
  },
  trainerBioFull: {
    fontSize: 13, fontWeight: '300', color: 'rgba(255,255,255,0.75)',
    lineHeight: 20, marginTop: 6, alignSelf: 'stretch',
    textAlign: 'center',
  },
  trainerActionsRow: {
    flexDirection: 'row', gap: 10, marginTop: 10,
    alignSelf: 'stretch',
  },
  trainerBookBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 12,
  },
  trainerBookBtnText: { fontSize: 14, fontWeight: '600', color: '#0d0d0d' },
  trainerProfileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)',
  },
  trainerProfileBtnText: { fontSize: 13, fontWeight: '500', color: TEXT },

  actionButton: {
    backgroundColor: GOLD, paddingVertical: 14, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 8,
  },
  actionButtonPressed: { opacity: 0.8 },
  actionButtonText: { fontSize: 16, fontWeight: '600', color: '#0d0d0d' },

  // Sort sheet
  sortSheet: { backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12 },
  sortTitle: { fontSize: 17, fontWeight: '500', color: TEXT, marginBottom: 16 },
  sortOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  sortOptionActive: { borderBottomColor: 'transparent' },
  sortOptionText: { fontSize: 15, color: DIM, fontWeight: '300' },
  sortOptionTextActive: { color: TEXT, fontWeight: '400' },

  // Filters sheet
  filtersSheet: {
    backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
  },
  filtersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  resetText: { fontSize: 13, color: GOLD, fontWeight: '500' },
  filterSectionLabel: {
    fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginBottom: 10,
  },
  distanceRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  distanceChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG,
  },
  distanceChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  distanceChipText: { fontSize: 13, fontWeight: '400', color: DIM },
  distanceChipTextActive: { color: '#0a0a0a', fontWeight: '600' },
  categoryRow: { paddingHorizontal: 16, gap: 8 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG,
  },
  categoryChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  categoryChipText: { fontSize: 13, fontWeight: '400', color: DIM },
  categoryChipTextActive: { color: '#0a0a0a', fontWeight: '600' },
});
