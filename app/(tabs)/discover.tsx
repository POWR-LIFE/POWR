import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as RNImage,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileButton } from '@/components/ProfileButton';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { useGeofenceContext, type Partner, type DayKey, type DayHours, type OpeningHours } from '@/context/GeofenceContext';
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

const DAY_LABELS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

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
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [sortMenuVisible, setSortMenuVisible] = useState(false);

  const { partners: rawPartners } = useGeofenceContext();
  const { activeGeofence } = useActiveGeofence();

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
          onPress={() => setRoutePartner(null)}
        >
          {filtered.map((partner) => (
            <React.Fragment key={partner.id}>
              <Circle
                center={{ latitude: partner.lat, longitude: partner.lng }}
                radius={partner.geofenceRadius}
                strokeColor={
                  partner.id === activeGeofence?.partnerId
                    ? 'rgba(232,210,0,0.9)'
                    : 'rgba(255,255,255,0.18)'
                }
                fillColor={
                  partner.id === activeGeofence?.partnerId
                    ? 'rgba(232,210,0,0.15)'
                    : 'rgba(255,255,255,0.04)'
                }
                strokeWidth={partner.id === activeGeofence?.partnerId ? 2.5 : 1}
              />
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
              strokeWidth={4}
              strokeColor={GOLD}
              mode="WALKING"
              resetOnChange={false}
              onError={(msg) => console.error('Directions error:', msg)}
            />
          )}
        </MapView>

        <View style={{ position: 'absolute', top: insets.top + 12, right: 16 }}>
          <ProfileButton />
        </View>
      </View>

      {/* ── List + filters ───────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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

        {/* Category pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
        >
          {CATEGORIES.map((cat) => {
            const active = cat === activeCategory;
            return (
              <Pressable
                key={cat}
                style={[styles.categoryChip, active && styles.categoryChipActive]}
                onPress={() => setActiveCategory(cat)}
              >
                <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

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
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {selectedPartner && (
              <>
                {/* Handle */}
                <View style={styles.modalHeroHandle} />

                {/* Two gallery images across top */}
                <View style={styles.modalGalleryRow}>
                  <View style={styles.modalTile}>
                    {selectedPartner.image1Url ? (
                      <Image source={{ uri: selectedPartner.image1Url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                    ) : (
                      <View style={styles.modalTilePlaceholder}>
                        <Ionicons name="fitness-outline" size={22} color="rgba(255,255,255,0.1)" />
                      </View>
                    )}
                    <LinearGradient
                      colors={['transparent', 'rgba(18,18,18,0.5)']}
                      style={styles.modalTileFade}
                      pointerEvents="none"
                    />
                  </View>
                  <View style={styles.modalTile}>
                    {selectedPartner.image2Url ? (
                      <Image source={{ uri: selectedPartner.image2Url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                    ) : (
                      <View style={styles.modalTilePlaceholder}>
                        <Ionicons name="barbell-outline" size={22} color="rgba(255,255,255,0.1)" />
                      </View>
                    )}
                    <LinearGradient
                      colors={['transparent', 'rgba(18,18,18,0.5)']}
                      style={styles.modalTileFade}
                      pointerEvents="none"
                    />
                  </View>

                  {/* Close button */}
                  <Pressable onPress={() => setSelectedPartner(null)} style={styles.modalHeroClose}>
                    <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                </View>

                {/* Logo + info row */}
                <View style={styles.modalBrandRow}>
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

                  <View style={styles.modalBrandInfo}>
                    <Text style={styles.modalPartnerName} numberOfLines={1} adjustsFontSizeToFit>{selectedPartner.name}</Text>
                    <View style={styles.modalInfoRow}>
                      <View style={[styles.modalStatusDot, selectedPartner.isOpenNow ? styles.modalStatusOpen : styles.modalStatusClosed]} />
                      <Text style={styles.modalInfoText}>
                        {selectedPartner.isOpenNow ? 'Open' : 'Closed'}
                      </Text>
                      <View style={styles.modalInfoSep} />
                      <Text style={styles.modalInfoText}>{selectedPartner.category}</Text>
                    </View>
                    <View style={styles.modalDetailItem}>
                      <Ionicons name="time-outline" size={12} color={DIM} />
                      <Text style={styles.modalDetailText}>{formatHours(selectedPartner.openingHours)}</Text>
                    </View>
                    <View style={styles.modalDetailItem}>
                      <Ionicons name="location-sharp" size={12} color={DIM} />
                      <Text style={styles.modalDetailText}>{selectedPartner.distance} · {selectedPartner.area}</Text>
                    </View>
                  </View>

                  <View style={styles.modalPillsCol}>
                    <View style={styles.rewardPill}>
                      <Ionicons name="flash" size={10} color={GOLD} />
                      <Text style={styles.rewardPillText}>+{selectedPartner.pts}</Text>
                    </View>
                    <View style={styles.rewardPill}>
                      <Ionicons name="trending-up" size={10} color={GOLD} />
                      <Text style={styles.rewardPillText}>x3</Text>
                    </View>
                  </View>
                </View>

                {/* Body */}
                <View style={styles.modalBody}>
                  {selectedPartner.description ? (
                    <Text style={styles.description}>{selectedPartner.description}</Text>
                  ) : null}

                  <Pressable
                    style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                    onPress={() => {
                      setRoutePartner(selectedPartner);
                      setSelectedPartner(null);
                    }}
                  >
                    <Ionicons name="navigate" size={18} color="#0d0d0d" />
                    <Text style={styles.actionButtonText}>Get Directions</Text>
                  </Pressable>
                </View>
              </>
            )}
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
        pressed && { opacity: 0.8 },
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
        <Text style={[styles.partnerName, isActive && { color: GOLD }]}>{partner.name}</Text>
        <Text style={styles.partnerMeta}>
          {isActive ? 'Session active' : partner.isOpenNow ? 'Open now' : 'Closed'} · {partner.area}
        </Text>
      </View>
      <View style={styles.partnerRight}>
        <Text style={styles.partnerPts}>+{partner.pts} pts</Text>
        <Text style={styles.partnerDistance}>{partner.distance}</Text>
      </View>
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

  categoryRow: { gap: 8, paddingRight: 4 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG,
  },
  categoryChipActive: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.25)' },
  categoryChipText: { fontSize: 13, fontWeight: '400', color: DIM },
  categoryChipTextActive: { color: TEXT, fontWeight: '500' },

  sectionLabel: {
    fontSize: 9, fontWeight: '500', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', paddingLeft: 2,
  },

  emptyState: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, color: DIM, fontWeight: '300' },
  emptyReset: { fontSize: 13, color: GOLD, fontWeight: '500', marginTop: 4 },

  partnerRow: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 14,
    padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  partnerRowActive: { backgroundColor: 'rgba(232,210,0,0.07)', borderColor: 'rgba(232,210,0,0.3)' },
  logoBox: {
    width: 52, height: 52, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
  },
  logoBoxLight: { backgroundColor: '#F2F2F2' },
  logoText: { fontSize: 8, fontWeight: '700', color: DIM, textAlign: 'center', letterSpacing: 0.3 },
  logoTextDark: { color: '#1a1a1a' },
  partnerInfo: { flex: 1, gap: 3 },
  partnerName: { fontSize: 15, fontWeight: '300', color: TEXT },
  partnerMeta: { fontSize: 11, fontWeight: '300', color: DIM },
  partnerRight: { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  partnerPts: { fontSize: 13, fontWeight: '500', color: GOLD },
  partnerDistance: { fontSize: 11, fontWeight: '300', color: DIM },
  logoImage: { width: '100%', height: '100%' },

  comingSoonRow: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 14,
    padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  comingSoonIcon: {
    width: 52, height: 52, borderRadius: 10,
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
  modalHeroHandle: {
    width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 12,
  },
  modalGalleryRow: {
    flexDirection: 'row', marginHorizontal: 16, height: 110, gap: 6,
  },
  modalTile: {
    flex: 1, borderRadius: 14, overflow: 'hidden',
  },
  modalTilePlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  modalTileFade: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
  },
  modalHeroClose: {
    position: 'absolute', top: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  modalBrandRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 20, marginTop: 16, marginBottom: 4,
  },
  modalLogoCard: {
    width: 96, height: 96, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', padding: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  modalLogoImg: { width: '100%', height: '100%' },
  modalLogoFallback: {
    fontSize: 14, fontWeight: '800', color: 'rgba(255,255,255,0.5)',
    textAlign: 'center', letterSpacing: 0.5,
  },
  modalBrandInfo: { flex: 1, gap: 4 },
  modalPartnerName: { fontSize: 22, fontWeight: '400', color: TEXT },
  modalInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modalStatusDot: { width: 5, height: 5, borderRadius: 2.5 },
  modalStatusOpen: { backgroundColor: '#4ade80' },
  modalStatusClosed: { backgroundColor: '#f87171' },
  modalInfoText: { fontSize: 12, color: DIM, fontWeight: '300' },
  modalInfoSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.15)' },
  modalDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modalDetailText: { fontSize: 12, color: DIM, fontWeight: '300' },
  modalPillsCol: { gap: 6, alignItems: 'stretch', justifyContent: 'center' },
  modalBody: { gap: 10, paddingBottom: 16, paddingHorizontal: 20, paddingTop: 8 },

  description: { fontSize: 13, color: DIM, lineHeight: 19, fontWeight: '300' },

  rewardPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'transparent', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: GOLD,
    minWidth: 58,
  },
  rewardPillText: { fontSize: 13, color: GOLD, fontWeight: '600' },

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
});
