/**
 * Web fallback for the Discover tab.
 * react-native-maps is native-only — this file is loaded instead on web.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD    = '#facc15';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

type Category = 'All' | 'Gym' | 'Yoga' | 'Pilates' | 'Cycling' | 'Running';
const CATEGORIES: Category[] = ['All', 'Gym', 'Yoga', 'Pilates', 'Cycling', 'Running'];

const PARTNERS = [
  { id: '1', name: 'Third Space Chelsea', category: 'Gym',  status: 'Open now',  area: 'Chelsea', pts: 50, distance: '0.2 mi', logoText: 'THIRD\nSPACE', logoLight: true  },
  { id: '2', name: "Barry's Bootcamp",    category: 'HIIT', status: 'Open now',  area: 'Euston',  pts: 40, distance: '0.4 mi', logoText: "BARRY'S",     logoLight: false },
  { id: '3', name: 'Triyoga Camden',      category: 'Yoga', status: 'Opens 8am', area: 'Camden',  pts: 30, distance: '0.7 mi', logoText: 'tri\nyoga',   logoLight: true  },
];

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [search, setSearch] = useState('');

  const filtered = activeCategory === 'All'
    ? PARTNERS
    : PARTNERS.filter((p) => p.category.toLowerCase() === activeCategory.toLowerCase());

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>Fitness partners near you</Text>
      </View>

      {/* Map not available on web */}
      <View style={styles.mapPlaceholder}>
        <Ionicons name="map-outline" size={28} color={MUTED} />
        <Text style={styles.mapPlaceholderText}>Map available on iOS & Android</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {CATEGORIES.map((cat) => {
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

        <Text style={styles.sectionLabel}>NEAREST PARTNERS</Text>

        {filtered.map((partner) => (
          <Pressable key={partner.id} style={({ pressed }) => [styles.partnerRow, pressed && { opacity: 0.8 }]}>
            <View style={[styles.logoBox, partner.logoLight && styles.logoBoxLight]}>
              <Text style={[styles.logoText, partner.logoLight && styles.logoTextDark]} numberOfLines={2} adjustsFontSizeToFit>
                {partner.logoText}
              </Text>
            </View>
            <View style={styles.partnerInfo}>
              <Text style={styles.partnerName}>{partner.name}</Text>
              <Text style={styles.partnerMeta}>{partner.category} · {partner.status} · {partner.area}</Text>
            </View>
            <View style={styles.partnerRight}>
              <Text style={styles.partnerPts}>+{partner.pts} pts</Text>
              <Text style={styles.partnerDistance}>{partner.distance}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 30, fontWeight: '200', letterSpacing: -0.5, color: TEXT },
  subtitle: { fontSize: 12, fontWeight: '300', color: DIM, marginTop: 2 },

  mapPlaceholder: {
    height: 100,
    marginHorizontal: 12,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapPlaceholderText: { fontSize: 12, fontWeight: '300', color: MUTED },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, gap: 10, paddingTop: 14 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 10,
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
    fontSize: 9, fontWeight: '500', letterSpacing: 2,
    color: MUTED, textTransform: 'uppercase', paddingLeft: 2,
  },

  partnerRow: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  logoBox: {
    width: 52, height: 52, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
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
});
