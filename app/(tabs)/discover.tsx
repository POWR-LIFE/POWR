import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#facc15';
const BG      = '#0d0d0d';
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

// Google Maps dark style — matches POWR #0d0d0d palette
const DARK_MAP_STYLE = [
  { elementType: 'geometry',                                    stylers: [{ color: '#0d0d0d' }] },
  { elementType: 'labels.text.fill',                            stylers: [{ color: '#444444' }] },
  { elementType: 'labels.text.stroke',                          stylers: [{ color: '#0d0d0d' }] },
  { featureType: 'road',         elementType: 'geometry',       stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road',         elementType: 'geometry.stroke',stylers: [{ color: '#212121' }] },
  { featureType: 'road.highway', elementType: 'geometry',       stylers: [{ color: '#1e1e1e' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke',stylers: [{ color: '#282828' }] },
  { featureType: 'road',         elementType: 'labels.text.fill',stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'water',        elementType: 'geometry',       stylers: [{ color: '#060606' }] },
  { featureType: 'water',        elementType: 'labels.text.fill',stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'poi',                                          stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',                                      stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry',     stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
];

// ─── Mock data ────────────────────────────────────────────────────────────────

type Category = 'All' | 'Gym' | 'Yoga' | 'Pilates' | 'Cycling' | 'Running';
const CATEGORIES: Category[] = ['All', 'Gym', 'Yoga', 'Pilates', 'Cycling', 'Running'];

interface Partner {
  id: string;
  name: string;
  category: string;
  status: string;
  area: string;
  pts: number;
  distance: string;
  logoText: string;
  logoLight: boolean;
  lat: number;
  lng: number;
  geofenceRadius: number; // metres
}

const PARTNERS: Partner[] = [
  {
    id: '1',
    name: 'Third Space Chelsea',
    category: 'Gym',
    status: 'Open now',
    area: 'Chelsea',
    pts: 50,
    distance: '0.2 mi',
    logoText: 'THIRD\nSPACE',
    logoLight: true,
    lat: 51.4871,
    lng: -0.1697,
    geofenceRadius: 50,
  },
  {
    id: '2',
    name: "Barry's Bootcamp",
    category: 'HIIT',
    status: 'Open now',
    area: 'Euston',
    pts: 40,
    distance: '0.4 mi',
    logoText: "BARRY'S",
    logoLight: false,
    lat: 51.5272,
    lng: -0.1396,
    geofenceRadius: 50,
  },
  {
    id: '3',
    name: 'Triyoga Camden',
    category: 'Yoga',
    status: 'Opens 8am',
    area: 'Camden',
    pts: 30,
    distance: '0.7 mi',
    logoText: 'tri\nyoga',
    logoLight: true,
    lat: 51.5390,
    lng: -0.1444,
    geofenceRadius: 50,
  },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setLocationGranted(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion(
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        800,
      );
    })();
  }, []);

  const filtered = activeCategory === 'All'
    ? PARTNERS
    : PARTNERS.filter((p) => p.category.toLowerCase() === activeCategory.toLowerCase());

  return (
    <View style={styles.screen}>
      {/* ── Map (edge-to-edge, extends behind status bar) ─────── */}
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
        >
          {PARTNERS.map((partner) => (
            <React.Fragment key={partner.id}>
              {/* Geofence radius ring */}
              <Circle
                center={{ latitude: partner.lat, longitude: partner.lng }}
                radius={partner.geofenceRadius}
                strokeColor="rgba(250,204,21,0.4)"
                fillColor="rgba(250,204,21,0.06)"
                strokeWidth={1}
              />
              {/* Partner marker */}
              <Marker
                coordinate={{ latitude: partner.lat, longitude: partner.lng }}
                title={partner.name}
                tracksViewChanges={false}
              >
                <PartnerPin partner={partner} />
              </Marker>
            </React.Fragment>
          ))}
        </MapView>

        {/* Title overlay */}
        <View style={[styles.mapTitleOverlay, { top: insets.top + 12 }]}>
          <Text style={styles.mapTitle}>Discover</Text>
          <Text style={styles.mapSubtitle}>Partner gyms. Earn when you show up.</Text>
        </View>
      </View>

      {/* ── Scrollable list ────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Filter chips */}
        <View style={styles.filterRow}>
          <FilterChip label="Open Now" active onPress={() => {}} trailing="▾" />
          <FilterChip label="Nearest" onPress={() => {}} trailing="▾" />
          <FilterChip label="Filters" onPress={() => {}} icon="options-outline" />
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

        <Text style={styles.sectionLabel}>NEAREST PARTNERS</Text>

        {filtered.map((partner) => (
          <PartnerListRow key={partner.id} partner={partner} />
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
    </View>
  );
}

// ─── Partner map pin ──────────────────────────────────────────────────────────

function PartnerPin({ partner }: { partner: Partner }) {
  return (
    <View style={styles.pinWrapper}>
      <View style={styles.pinBadge}>
        <View style={styles.pinDot} />
        <Text style={styles.pinText}>+{partner.pts}</Text>
      </View>
      <View style={styles.pinStem} />
    </View>
  );
}

// ─── Partner list row ─────────────────────────────────────────────────────────

function PartnerListRow({ partner }: { partner: Partner }) {
  return (
    <Pressable style={({ pressed }) => [styles.partnerRow, pressed && { opacity: 0.8 }]}>
      <View style={[styles.logoBox, partner.logoLight && styles.logoBoxLight]}>
        <Text
          style={[styles.logoText, partner.logoLight && styles.logoTextDark]}
          numberOfLines={2}
          adjustsFontSizeToFit
        >
          {partner.logoText}
        </Text>
      </View>
      <View style={styles.partnerInfo}>
        <Text style={styles.partnerName}>{partner.name}</Text>
        <Text style={styles.partnerMeta}>
          {partner.category} · {partner.status} · {partner.area}
        </Text>
      </View>
      <View style={styles.partnerRight}>
        <Text style={styles.partnerPts}>+{partner.pts} pts</Text>
        <Text style={styles.partnerDistance}>{partner.distance}</Text>
      </View>
    </Pressable>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({
  label, active, trailing, icon, onPress,
}: {
  label: string; active?: boolean; trailing?: string; icon?: string; onPress: () => void;
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
      {trailing && (
        <Text style={[styles.filterChipTrailing, active && styles.filterChipTextActive]}>
          {trailing}
        </Text>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  // Map
  mapContainer: {
    width: '100%',
    overflow: 'hidden',
  },
  mapTitleOverlay: {
    position: 'absolute',
    left: 16,
  },
  mapTitle: {
    fontSize: 30,
    fontWeight: '200',
    letterSpacing: -0.5,
    color: TEXT,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  mapSubtitle: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Partner map pin
  pinWrapper: {
    alignItems: 'center',
  },
  pinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(13,13,13,0.92)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.5)',
  },
  pinDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  pinText: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
  },
  pinStem: {
    width: 1.5,
    height: 6,
    backgroundColor: 'rgba(250,204,21,0.6)',
  },

  // List
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 12,
    gap: 10,
    paddingTop: 14,
  },

  // Filter row
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
  },
  filterChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  filterChipText: { fontSize: 12, fontWeight: '400', color: DIM },
  filterChipTextActive: { color: '#0a0a0a', fontWeight: '600' },
  filterChipTrailing: { fontSize: 10, color: DIM },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
    padding: 0,
  },

  // Category pills
  categoryRow: { gap: 8, paddingRight: 4 },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
  },
  categoryChipActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  categoryChipText: { fontSize: 13, fontWeight: '400', color: DIM },
  categoryChipTextActive: { color: TEXT, fontWeight: '500' },

  // Section label
  sectionLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
    paddingLeft: 2,
  },

  // Partner rows
  partnerRow: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  logoBoxLight: { backgroundColor: '#F2F2F2' },
  logoText: {
    fontSize: 8,
    fontWeight: '700',
    color: DIM,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  logoTextDark: { color: '#1a1a1a' },
  partnerInfo: { flex: 1, gap: 3 },
  partnerName: { fontSize: 15, fontWeight: '300', color: TEXT },
  partnerMeta: { fontSize: 11, fontWeight: '300', color: DIM },
  partnerRight: { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  partnerPts: { fontSize: 13, fontWeight: '500', color: GOLD },
  partnerDistance: { fontSize: 11, fontWeight: '300', color: DIM },

  // Coming soon
  comingSoonRow: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  comingSoonIcon: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  comingSoonPlus: { fontSize: 22, fontWeight: '200', color: GOLD },
  comingSoonInfo: { flex: 1, gap: 3 },
  comingSoonTitle: { fontSize: 14, fontWeight: '300', color: TEXT },
  comingSoonSub: { fontSize: 11, fontWeight: '300', color: DIM },
});
