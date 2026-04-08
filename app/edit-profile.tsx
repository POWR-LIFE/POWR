import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import GeometricBackground from '@/components/GeometricBackground';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { fetchProfile, updateProfile, uploadAvatar, type Profile } from '@/lib/api/user';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const INPUT_BG = 'transparent';
const INPUT_BORDER = 'rgba(255,255,255,0.12)';
const INPUT_BORDER_FOCUS = 'rgba(255,255,255,0.8)';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null); // local URI or remote URL
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile().then((p) => {
      if (!p) return;
      setProfile(p);
      setDisplayName(p.display_name ?? '');
      setUsername(p.username ?? '');
      setAvatarUri(p.avatar_url);
    });
  }, []);

  // Derived initials for placeholder avatar
  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  // ── Image picker ────────────────────────────────────────────────────────────

  async function pickImage(source: 'library' | 'camera') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (perm.status !== 'granted') {
      Alert.alert(
        'Permission required',
        source === 'camera'
          ? 'Please allow camera access in Settings to take a photo.'
          : 'Please allow photo library access in Settings to choose a photo.'
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });

    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      setAvatarChanged(true);
    }
  }

  function showPhotoOptions() {
    Alert.alert('Profile photo', 'Choose a source', [
      { text: 'Take photo', onPress: () => pickImage('camera') },
      { text: 'Choose from library', onPress: () => pickImage('library') },
      ...(avatarUri ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: () => { setAvatarUri(null); setAvatarChanged(true); } }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    const trimmedName = displayName.trim();
    const trimmedUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a display name.');
      return;
    }

    setSaving(true);
    try {
      const updates: Parameters<typeof updateProfile>[0] = {
        display_name: trimmedName,
        username: trimmedUsername || null,
      };

      // Upload new avatar if changed
      if (avatarChanged) {
        if (avatarUri) {
          const { url, error: uploadErr } = await uploadAvatar(avatarUri);
          if (uploadErr) {
            Alert.alert('Upload failed', uploadErr);
            return;
          }
          updates.avatar_url = url;
        } else {
          updates.avatar_url = null;
        }
      }

      const { error } = await updateProfile(updates);
      if (error) {
        Alert.alert('Save failed', error);
        return;
      }

      router.back();
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <Pressable
          style={[styles.headerBtn, styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          hitSlop={8}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#0a0a0a" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Avatar ─────────────────────────────────────────── */}
          <View style={styles.avatarSection}>
            <Pressable style={styles.avatarWrap} onPress={showPhotoOptions}>
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={14} color={TEXT} />
              </View>
            </Pressable>
            <Text style={styles.avatarHint}>Tap to change photo</Text>
          </View>

          {/* ── Fields ─────────────────────────────────────────── */}
          <SectionLabel label="Display Name" />
          <View style={[
            styles.inputWrap,
            focusedField === 'name' && styles.inputWrapFocused,
          ]}>
            <Ionicons name="person-outline" size={16} color={DIM} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor={MUTED}
              autoCorrect={false}
              maxLength={40}
              onFocus={() => setFocusedField('name')}
              onBlur={() => setFocusedField(null)}
            />
            {displayName.length > 0 && (
              <Pressable onPress={() => setDisplayName('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={MUTED} />
              </Pressable>
            )}
          </View>
          <Text style={styles.fieldHint}>{displayName.length}/40 · Shown on your profile and leaderboards</Text>

          <SectionLabel label="Username" />
          <View style={[
            styles.inputWrap,
            focusedField === 'username' && styles.inputWrapFocused,
          ]}>
            <Text style={styles.atSign}>@</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="yourhandle"
              placeholderTextColor={MUTED}
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={30}
              onFocus={() => setFocusedField('username')}
              onBlur={() => setFocusedField(null)}
            />
            {username.length > 0 && (
              <Pressable onPress={() => setUsername('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={MUTED} />
              </Pressable>
            )}
          </View>
          <Text style={styles.fieldHint}>Letters, numbers, underscores only · {username.length}/30</Text>

          {/* ── Read-only info ──────────────────────────────────── */}
          <SectionLabel label="Email" />
          <View style={styles.readonlyRow}>
            <Ionicons name="mail-outline" size={16} color={DIM} style={styles.inputIcon} />
            <Text style={styles.readonlyText}>{user?.email ?? '—'}</Text>
            <Text style={styles.readonlyBadge}>Can't change</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },
  headerTitle: { fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
  saveBtn: {
    backgroundColor: GOLD,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    width: 'auto' as any,
    borderRadius: 20,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 13, fontWeight: '600', color: '#0a0a0a', letterSpacing: 0.3 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },

  // Avatar
  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  avatarWrap: { position: 'relative' },
  avatarImage: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 32, fontWeight: '600', color: '#0a0a0a' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarHint: { fontSize: 11, fontWeight: '300', color: MUTED, letterSpacing: 0.3 },

  // Section label
  sectionLabel: {
    fontSize: 9, fontWeight: '500', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', paddingTop: 12, paddingBottom: 4, paddingHorizontal: 2,
  },

  // Inputs
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: INPUT_BG, borderRadius: 14,
    borderWidth: 1, borderColor: INPUT_BORDER,
    paddingHorizontal: 14, paddingVertical: 13, gap: 10,
  },
  inputWrapFocused: { borderColor: INPUT_BORDER_FOCUS },
  inputIcon: { flexShrink: 0 },
  atSign: { fontSize: 15, fontWeight: '300', color: DIM, flexShrink: 0 },
  input: {
    flex: 1, fontSize: 15, fontWeight: '300',
    color: TEXT, padding: 0,
  },
  fieldHint: {
    fontSize: 10, fontWeight: '300', color: MUTED,
    paddingHorizontal: 4, paddingBottom: 4,
  },

  // Read-only row
  readonlyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: INPUT_BG, borderRadius: 14,
    borderWidth: 1, borderColor: INPUT_BORDER,
    paddingHorizontal: 14, paddingVertical: 13, gap: 10,
    opacity: 0.6,
  },
  readonlyText: { flex: 1, fontSize: 15, fontWeight: '300', color: DIM },
  readonlyBadge: {
    fontSize: 10, fontWeight: '500', letterSpacing: 0.5, color: MUTED,
    textTransform: 'uppercase',
  },
});
