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
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileButton } from '@/components/ProfileButton';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { useGeofenceContext, type Partner } from '@/context/GeofenceContext';
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

// Google Maps dark style — slightly lifted from pure black for legibility
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

// ─── Types and Helper ─────────────────────────────────────────────────────────

type Category = 'All' | 'Gym' | 'Yoga' | 'Pilates' | 'Cycling' | 'Running';
const CATEGORIES: Category[] = ['All', 'Gym', 'Yoga', 'Pilates', 'Cycling', 'Running'];

// Haversine formula to calculate distance in miles
function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // Radius of earth in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [search, setSearch] = useState('');
  const [userLoc, setUserLoc] = useState<Location.LocationObject | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [routePartner, setRoutePartner] = useState<Partner | null>(null);

  const { partners: rawPartners } = useGeofenceContext();
  const { activeGeofence } = useActiveGeofence();

  // Add distance and sort by proximity whenever user location or partner list changes
  const partners = useMemo(() => {
    if (!userLoc) return rawPartners;
    return [...rawPartners]
      .map(p => {
        const miles = getDistanceMiles(
          userLoc.coords.latitude, userLoc.coords.longitude, p.lat, p.lng,
        );
        return { ...p, distance: miles < 0.1 ? '< 0.1 mi' : `${miles.toFixed(1)} mi` };
      })
      .sort((a, b) => {
        const dA = getDistanceMiles(userLoc.coords.latitude, userLoc.coords.longitude, a.lat, a.lng);
        const dB = getDistanceMiles(userLoc.coords.latitude, userLoc.coords.longitude, b.lat, b.lng);
        return dA - dB;
      });
  }, [rawPartners, userLoc]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setLocationGranted(true);
      
      let loc;
      try {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      } catch (err) {
        loc = await Location.getLastKnownPositionAsync();
      }
      
      if (loc) {
        setUserLoc(loc);
        mapRef.current?.animateToRegion(
          {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          },
          800,
        );
      }
    })();
  }, []);

  const filtered = activeCategory === 'All'
    ? partners
    : partners.filter((p) => p.category.toLowerCase() === activeCategory.toLowerCase());

  return (
    <View style={styles.screen}>
      <GeometricBackground />
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
          onPress={() => setRoutePartner(null)}
        >
          {partners.map((partner) => (
            <React.Fragment key={partner.id}>
              {/* Geofence radius ring - lights up in full gold when user is inside */}
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
              {/* Partner marker */}
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

          {/* Directions Route */}
          {routePartner && userLoc && process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY && (
            <MapViewDirections
              origin={{ latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude }}
              destination={{ latitude: routePartner.lat, longitude: routePartner.lng }}
              apikey={process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}
              strokeWidth={4}
              strokeColor={GOLD}
              mode="WALKING"
              resetOnChange={false} // Prevents flashing route
              onError={(errorMessage) => {
                console.error('Directions error:', errorMessage);
                alert(`Directions Error: ${errorMessage}`);
              }}
              onReady={(result) => {
                console.log(`Distance: ${result.distance} km`);
                console.log(`Duration: ${result.duration} min`);
              }}
            />
          )}
        </MapView>

        <View style={{ position: 'absolute', top: insets.top + 12, right: 16 }}>
          <ProfileButton />
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

      {/* ── Partner Modal ────────────────────────────────────────── */}
      <Modal
        visible={!!selectedPartner}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedPartner(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.modalHandle} />
            
            {selectedPartner && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalLogoBox, selectedPartner.logoLight && styles.logoBoxLight]}>
                    {selectedPartner.logoUrl ? (
                      <Image 
                        source={{ uri: selectedPartner.logoUrl }} 
                        style={styles.logoImage} 
                        contentFit="contain" 
                      />
                    ) : (
                      <Text
                        style={[styles.modalLogoText, selectedPartner.logoLight && styles.logoTextDark]}
                        numberOfLines={2}
                        adjustsFontSizeToFit
                      >
                        {selectedPartner.logoText}
                      </Text>
                    )}
                  </View>
                  <View style={styles.modalTitleContainer}>
                     <Text style={styles.modalTitle}>{selectedPartner.name}</Text>
                     <Text style={styles.modalMeta}>
                       {selectedPartner.category} · {selectedPartner.area} · {selectedPartner.distance}
                     </Text>
                  </View>
                  <Pressable onPress={() => setSelectedPartner(null)} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color={DIM} />
                  </Pressable>
                </View>

                <View style={styles.modalBody}>
                  <View style={styles.earnBox}>
                    <View style={styles.earnHeader}>
                       <Ionicons name="location-sharp" size={16} color={GOLD} />
                       <Text style={styles.earnTitle}>Earn Here</Text>
                    </View>
                    <Text style={styles.earnDesc}>
                      Walk inside the {selectedPartner.geofenceRadius}m radius. Dwell for 20 minutes to automatically earn points.
                    </Text>
                    <View style={styles.rewardPills}>
                       <View style={styles.rewardPill}>
                         <Text style={styles.rewardPillText}>Base +{selectedPartner.pts} POWR</Text>
                       </View>
                       <View style={styles.rewardPill}>
                         <Text style={styles.rewardPillText}>x3 Top Streak</Text>
                       </View>
                    </View>
                  </View>

                  {/* Action Buttons */}
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
    </View>
  );
}

// ─── Partner map pin ──────────────────────────────────────────────────────────

function PartnerPin({
  partner,
  isActive,
}: {
  partner: Partner;
  isActive?: boolean;
}) {
  return (
    <View style={[styles.pinCircle, partner.logoLight && styles.pinCircleLight, isActive && styles.pinCircleActive]}>
      {partner.logoUrl ? (
        <RNImage
          source={{ uri: partner.logoUrl }}
          style={styles.pinLogoImage}
          resizeMode="contain"
        />
      ) : (
        <Text style={[styles.pinLogoFallback, partner.logoLight && { color: '#000' }]} numberOfLines={1}>
          {partner.logoText.split('\n')[0]}
        </Text>
      )}
    </View>
  );
}

// ─── Partner list row ─────────────────────────────────────────────────────────

function PartnerListRow({
  partner,
  isActive,
  onPress,
}: {
  partner: Partner;
  isActive?: boolean;
  onPress?: () => void;
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
          <Image
            source={{ uri: partner.logoUrl }}
            style={styles.logoImage}
            contentFit="contain"
          />
        ) : (
          <Text
            style={[styles.logoText, partner.logoLight && styles.logoTextDark]}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            {partner.logoText}
          </Text>
        )}
      </View>
      <View style={styles.partnerInfo}>
        <Text style={[styles.partnerName, isActive && { color: GOLD }]}>{partner.name}</Text>
        <Text style={styles.partnerMeta}>
          {isActive ? 'Session active' : partner.status} · {partner.area}
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

  // Partner map pin - column layout so badge flows below the circle (no absolute positioning)
  pinCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0d0d0d',
    borderWidth: 1.5,
    borderColor: 'rgba(232,210,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 5,
    overflow: 'hidden',
  },
  pinCircleLight: {
    backgroundColor: '#F2F2F2',
  },
  pinCircleActive: {
    borderColor: GOLD,
    borderWidth: 2.5,
  },
  pinLogoImage: {
    width: '100%',
    height: '100%',
  },
  pinLogoFallback: {
    fontSize: 8,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
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
  partnerRowActive: {
    backgroundColor: 'rgba(232,210,0,0.07)',
    borderColor: 'rgba(232,210,0,0.3)',
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
  logoImage: { width: '100%', height: '100%' },

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
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  comingSoonPlus: { fontSize: 22, fontWeight: '200', color: GOLD },
  comingSoonInfo: { flex: 1, gap: 3 },
  comingSoonTitle: { fontSize: 14, fontWeight: '300', color: TEXT },
  comingSoonSub: { fontSize: 11, fontWeight: '300', color: DIM },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalLogoBox: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 16,
  },
  modalLogoText: {
    fontSize: 10,
    fontWeight: '700',
    color: DIM,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  modalTitleContainer: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '300',
    color: TEXT,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  modalMeta: {
    fontSize: 13,
    color: DIM,
    fontWeight: '300',
  },
  closeButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
  },
  modalBody: {
    gap: 16,
    paddingBottom: 16,
  },
  earnBox: {
    backgroundColor: 'rgba(232,210,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.2)',
    borderRadius: 16,
    padding: 16,
  },
  earnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  earnTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: GOLD,
  },
  earnDesc: {
    fontSize: 14,
    color: DIM,
    lineHeight: 20,
    marginBottom: 16,
  },
  rewardPills: {
    flexDirection: 'row',
    gap: 8,
  },
  rewardPill: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  rewardPillText: {
    fontSize: 12,
    color: TEXT,
    fontWeight: '500',
  },
  actionButton: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  actionButtonPressed: {
    opacity: 0.8,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0d0d0d',
  },
});
