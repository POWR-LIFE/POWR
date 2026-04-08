import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import type { DayKey, DayHours, OpeningHours } from '@/context/GeofenceContext';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.9)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const RED     = '#ef4444';
const GREEN   = '#4ade80';

// ─── Types ─────────────────────────────────────────────────────────────────────

type PartnerCategory = 'fashion' | 'gear' | 'nutrition' | 'gym' | 'food' | 'health';

const CATEGORIES: PartnerCategory[] = ['gym', 'health', 'nutrition', 'gear', 'fashion', 'food'];

interface Location {
  name: string;
  lat: number;
  lng: number;
  radius: number;
}

interface PartnerRow {
  id: string;
  name: string;
  description: string | null;
  category: PartnerCategory;
  logo_url: string | null;
  active: boolean;
  opening_hours: OpeningHours | null;
  locations: Location[] | null;
  created_at: string;
}

const DAY_LABELS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const BLANK_PARTNER: Omit<PartnerRow, 'id' | 'created_at'> = {
  name: '',
  description: null,
  category: 'gym',
  logo_url: null,
  active: true,
  opening_hours: {
    mon: { open: '06:00', close: '22:00' },
    tue: { open: '06:00', close: '22:00' },
    wed: { open: '06:00', close: '22:00' },
    thu: { open: '06:00', close: '22:00' },
    fri: { open: '06:00', close: '22:00' },
    sat: { open: '08:00', close: '20:00' },
    sun: { open: '09:00', close: '18:00' },
  },
  locations: [{ name: 'Main Location', lat: 51.5074, lng: -0.1278, radius: 100 }],
};

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function AdminPartnersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit modal state
  const [editPartner, setEditPartner] = useState<Partial<PartnerRow> & { id?: string } | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Check admin flag
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      setIsAdmin(data?.is_admin === true);
      setLoading(false);
    })();
  }, []);

  const fetchPartners = useCallback(async () => {
    const { data, error } = await supabase
      .from('partners')
      .select('id, name, description, category, logo_url, active, opening_hours, locations, created_at')
      .order('name');
    if (!error && data) setPartners(data as PartnerRow[]);
  }, []);

  useEffect(() => {
    if (isAdmin) fetchPartners();
  }, [isAdmin, fetchPartners]);

  const openNew = () => {
    setEditPartner({ ...BLANK_PARTNER });
    setIsNew(true);
  };

  const openEdit = (p: PartnerRow) => {
    setEditPartner({ ...p });
    setIsNew(false);
  };

  const savePartner = async () => {
    if (!editPartner || !editPartner.name?.trim()) {
      Alert.alert('Validation', 'Name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name:          editPartner.name.trim(),
        description:   editPartner.description || null,
        category:      editPartner.category,
        logo_url:      editPartner.logo_url || null,
        active:        editPartner.active ?? true,
        opening_hours: editPartner.opening_hours ?? null,
        locations:     editPartner.locations ?? null,
      };

      if (isNew) {
        const { error } = await supabase.from('partners').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('partners').update(payload).eq('id', editPartner.id!);
        if (error) throw error;
      }

      await fetchPartners();
      setEditPartner(null);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: PartnerRow) => {
    await supabase.from('partners').update({ active: !p.active }).eq('id', p.id);
    setPartners(prev => prev.map(x => x.id === p.id ? { ...x, active: !x.active } : x));
  };

  // ── Loading / unauthorized ───────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        <Ionicons name="lock-closed-outline" size={40} color={MUTED} />
        <Text style={{ color: DIM, fontSize: 15 }}>Admin access required</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: GOLD, fontSize: 14 }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  // ── Main UI ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Partners</Text>
        <Pressable style={styles.addBtn} onPress={openNew} hitSlop={8}>
          <Ionicons name="add" size={22} color={GOLD} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>{partners.length} PARTNERS</Text>

        {partners.map(p => (
          <Pressable
            key={p.id}
            style={({ pressed }) => [styles.partnerCard, pressed && { opacity: 0.8 }]}
            onPress={() => openEdit(p)}
          >
            <View style={styles.partnerCardLeft}>
              <View style={[styles.activeDot, p.active ? styles.activeDotOn : styles.activeDotOff]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.partnerCardName}>{p.name}</Text>
                <Text style={styles.partnerCardMeta}>
                  {p.category} · {p.locations?.length ?? 0} location{(p.locations?.length ?? 0) !== 1 ? 's' : ''}
                  {p.opening_hours ? ' · Hours set' : ' · No hours'}
                </Text>
              </View>
            </View>
            <View style={styles.partnerCardRight}>
              <Switch
                value={p.active}
                onValueChange={() => toggleActive(p)}
                trackColor={{ false: BORDER, true: 'rgba(232,210,0,0.4)' }}
                thumbColor={p.active ? GOLD : MUTED}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
              <Ionicons name="chevron-forward" size={16} color={MUTED} />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Edit / Create modal ─────────────────────────────────────────────── */}
      <Modal
        visible={!!editPartner}
        animationType="slide"
        transparent
        onRequestClose={() => setEditPartner(null)}
      >
        <View style={styles.editOverlay}>
          <View style={[styles.editSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.modalHandle} />
            <View style={styles.editHeader}>
              <Text style={styles.editTitle}>{isNew ? 'New Partner' : 'Edit Partner'}</Text>
              <Pressable onPress={() => setEditPartner(null)}>
                <Ionicons name="close" size={22} color={DIM} />
              </Pressable>
            </View>

            {editPartner && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Basic info */}
                <FieldLabel label="NAME" />
                <TextInput
                  style={styles.textInput}
                  value={editPartner.name ?? ''}
                  onChangeText={v => setEditPartner(p => ({ ...p!, name: v }))}
                  placeholder="e.g. The Iron Room"
                  placeholderTextColor={MUTED}
                />

                <FieldLabel label="DESCRIPTION" />
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={editPartner.description ?? ''}
                  onChangeText={v => setEditPartner(p => ({ ...p!, description: v || null }))}
                  placeholder="Short description shown on the partner card"
                  placeholderTextColor={MUTED}
                  multiline
                  numberOfLines={3}
                />

                <FieldLabel label="CATEGORY" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {CATEGORIES.map(cat => {
                    const active = editPartner.category === cat;
                    return (
                      <Pressable
                        key={cat}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setEditPartner(p => ({ ...p!, category: cat }))}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <FieldLabel label="LOGO URL" />
                <TextInput
                  style={styles.textInput}
                  value={editPartner.logo_url ?? ''}
                  onChangeText={v => setEditPartner(p => ({ ...p!, logo_url: v || null }))}
                  placeholder="https://..."
                  placeholderTextColor={MUTED}
                  autoCapitalize="none"
                  keyboardType="url"
                />

                {/* Active toggle */}
                <View style={styles.toggleRow}>
                  <View>
                    <Text style={styles.toggleLabel}>Active</Text>
                    <Text style={styles.toggleSub}>Visible to users on the map</Text>
                  </View>
                  <Switch
                    value={editPartner.active ?? true}
                    onValueChange={v => setEditPartner(p => ({ ...p!, active: v }))}
                    trackColor={{ false: BORDER, true: 'rgba(232,210,0,0.4)' }}
                    thumbColor={editPartner.active ? GOLD : MUTED}
                  />
                </View>

                {/* Opening hours */}
                <FieldLabel label="OPENING HOURS" />
                <OpeningHoursEditor
                  value={editPartner.opening_hours ?? {}}
                  onChange={oh => setEditPartner(p => ({ ...p!, opening_hours: oh }))}
                />

                {/* Locations */}
                <FieldLabel label="LOCATIONS" />
                <LocationsEditor
                  value={editPartner.locations ?? []}
                  onChange={locs => setEditPartner(p => ({ ...p!, locations: locs }))}
                />

                {/* Save */}
                <Pressable
                  style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.8 }, saving && { opacity: 0.6 }]}
                  onPress={savePartner}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#0d0d0d" />
                    : <Text style={styles.saveBtnText}>{isNew ? 'Create Partner' : 'Save Changes'}</Text>
                  }
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Opening Hours Editor ─────────────────────────────────────────────────────

function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHours;
  onChange: (oh: OpeningHours) => void;
}) {
  const setDay = (key: DayKey, hours: DayHours | null) => {
    onChange({ ...value, [key]: hours });
  };

  return (
    <View style={styles.hoursContainer}>
      {DAY_LABELS.map(({ key, label }) => {
        const dayHours = value[key];
        const isOpen = dayHours != null;
        return (
          <View key={key} style={styles.dayRow}>
            <View style={styles.dayLeft}>
              <Switch
                value={isOpen}
                onValueChange={on => setDay(key, on ? { open: '06:00', close: '22:00' } : null)}
                trackColor={{ false: BORDER, true: 'rgba(232,210,0,0.4)' }}
                thumbColor={isOpen ? GOLD : MUTED}
                style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
              />
              <Text style={[styles.dayLabel, !isOpen && { color: MUTED }]}>{label}</Text>
            </View>
            {isOpen ? (
              <View style={styles.timeInputs}>
                <TimeInput
                  value={dayHours!.open}
                  onChange={v => setDay(key, { open: v, close: dayHours!.close })}
                />
                <Text style={styles.timeSep}>–</Text>
                <TimeInput
                  value={dayHours!.close}
                  onChange={v => setDay(key, { open: dayHours!.open, close: v })}
                />
              </View>
            ) : (
              <Text style={styles.closedLabel}>Closed</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      style={styles.timeInput}
      value={value}
      onChangeText={onChange}
      placeholder="HH:MM"
      placeholderTextColor={MUTED}
      keyboardType="numbers-and-punctuation"
      maxLength={5}
    />
  );
}

// ─── Locations Editor ─────────────────────────────────────────────────────────

function LocationsEditor({
  value,
  onChange,
}: {
  value: Location[];
  onChange: (locs: Location[]) => void;
}) {
  const add = () => onChange([...value, { name: '', lat: 51.5074, lng: -0.1278, radius: 100 }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Location, val: string) => {
    const next = [...value];
    if (field === 'lat' || field === 'lng' || field === 'radius') {
      (next[i] as any)[field] = parseFloat(val) || 0;
    } else {
      (next[i] as any)[field] = val;
    }
    onChange(next);
  };

  return (
    <View style={{ gap: 12 }}>
      {value.map((loc, i) => (
        <View key={i} style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Text style={styles.locationIndex}>Location {i + 1}</Text>
            {value.length > 1 && (
              <Pressable onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={RED} />
              </Pressable>
            )}
          </View>
          <TextInput
            style={styles.textInput}
            value={loc.name}
            onChangeText={v => update(i, 'name', v)}
            placeholder="Location name (e.g. Main Gym)"
            placeholderTextColor={MUTED}
          />
          <View style={styles.coordRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.coordLabel}>Latitude</Text>
              <TextInput
                style={styles.textInput}
                value={String(loc.lat)}
                onChangeText={v => update(i, 'lat', v)}
                keyboardType="numeric"
                placeholder="51.5074"
                placeholderTextColor={MUTED}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.coordLabel}>Longitude</Text>
              <TextInput
                style={styles.textInput}
                value={String(loc.lng)}
                onChangeText={v => update(i, 'lng', v)}
                keyboardType="numeric"
                placeholder="-0.1278"
                placeholderTextColor={MUTED}
              />
            </View>
          </View>
          <Text style={styles.coordLabel}>Geofence Radius (metres)</Text>
          <TextInput
            style={styles.textInput}
            value={String(loc.radius)}
            onChangeText={v => update(i, 'radius', v)}
            keyboardType="numeric"
            placeholder="100"
            placeholderTextColor={MUTED}
          />
        </View>
      ))}
      <Pressable style={styles.addLocationBtn} onPress={add}>
        <Ionicons name="add-circle-outline" size={16} color={GOLD} />
        <Text style={styles.addLocationText}>Add Location</Text>
      </Pressable>
    </View>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '500', color: TEXT },
  backBtn: { padding: 8 },
  addBtn: { padding: 8 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },

  sectionLabel: {
    fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginBottom: 2,
  },

  partnerCard: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 14,
    padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  partnerCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  partnerCardRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activeDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  activeDotOn: { backgroundColor: GREEN },
  activeDotOff: { backgroundColor: RED },
  partnerCardName: { fontSize: 15, fontWeight: '300', color: TEXT },
  partnerCardMeta: { fontSize: 11, fontWeight: '300', color: DIM, marginTop: 2 },

  // Edit modal
  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, maxHeight: '92%',
  },
  modalHandle: {
    width: 40, height: 4, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  editHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  editTitle: { fontSize: 18, fontWeight: '500', color: TEXT },

  fieldLabel: {
    fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginBottom: 6, marginTop: 16,
  },
  textInput: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: TEXT, fontWeight: '300',
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },

  chipRow: { gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipActive: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.8)' },
  chipText: { fontSize: 13, color: DIM },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginTop: 16,
  },
  toggleLabel: { fontSize: 14, color: TEXT, fontWeight: '300' },
  toggleSub: { fontSize: 11, color: DIM, marginTop: 2 },

  // Opening hours
  hoursContainer: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, overflow: 'hidden',
  },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  dayLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 110 },
  dayLabel: { fontSize: 13, color: TEXT, fontWeight: '300' },
  timeInputs: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInput: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: BORDER,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 13, color: TEXT, width: 64, textAlign: 'center',
  },
  timeSep: { fontSize: 14, color: MUTED },
  closedLabel: { fontSize: 12, color: MUTED, fontStyle: 'italic' },

  // Locations
  locationCard: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, padding: 12, gap: 8,
  },
  locationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locationIndex: { fontSize: 12, fontWeight: '500', color: DIM, letterSpacing: 1, textTransform: 'uppercase' },
  coordRow: { flexDirection: 'row', gap: 8 },
  coordLabel: { fontSize: 11, color: MUTED, marginBottom: 4, marginTop: 4 },
  addLocationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)',
    borderRadius: 12, backgroundColor: 'rgba(232,210,0,0.05)',
    borderStyle: 'dashed',
  },
  addLocationText: { fontSize: 13, color: GOLD, fontWeight: '400' },

  saveBtn: {
    backgroundColor: GOLD, paddingVertical: 14, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 8,
  },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#0d0d0d' },
});
