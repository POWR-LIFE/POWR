import GeometricBackground from '@/components/GeometricBackground';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { fetchProfile, updateProfile, updateProProfile, uploadAvatar, uploadCover, type Profile } from '@/lib/api/user';
import { fetchGallery, uploadGalleryPhoto, deleteGalleryPhoto, type GalleryPhoto } from '@/lib/api/pro-gallery';
import {
  fetchAchievements,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  MAX_ACHIEVEMENTS,
  type Achievement,
  type AchievementInput,
} from '@/lib/api/pro-achievements';

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
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [coverChanged, setCoverChanged] = useState(false);
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [editingAchId, setEditingAchId] = useState<string | 'new' | null>(null);
  const [achForm, setAchForm] = useState<AchievementInput>({ title: '', value: '', context: '' });
  const [achSaving, setAchSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const MAX_GALLERY = 6;

  useEffect(() => {
    fetchProfile().then((p) => {
      if (!p) return;
      setProfile(p);
      setDisplayName(p.display_name ?? '');
      setUsername(p.username ?? '');
      setBio(p.bio ?? '');
      setAvatarUri(p.avatar_url);
      setCoverUri(p.cover_url);
      if (p.is_pro) {
        fetchGallery(p.id).then(setGallery);
        fetchAchievements(p.id).then(setAchievements);
      }
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
    try {
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

      // On Android, allowsEditing opens a separate crop Activity which can cause
      // the OS to destroy the RN Activity (losing navigation state and the
      // selected photo).  Keep editing enabled only on iOS.
      const allowsEditing = Platform.OS !== 'android';

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              allowsEditing,
              aspect: [1, 1],
              quality: 0.8,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing,
              aspect: [1, 1],
              quality: 0.8,
            });

      if (!result.canceled && result.assets[0]) {
        setAvatarUri(result.assets[0].uri);
        setAvatarChanged(true);
      }
    } catch (e) {
      console.warn('[EditProfile] Image picker error:', e);
      Alert.alert('Could not select photo', 'Please try again.');
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

  async function pickCover() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: Platform.OS !== 'android',
      aspect: [3, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setCoverUri(result.assets[0].uri);
      setCoverChanged(true);
    }
  }

  async function pickGalleryPhoto() {
    if (gallery.length >= MAX_GALLERY) {
      Alert.alert('Gallery full', `Maximum ${MAX_GALLERY} photos allowed.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: Platform.OS !== 'android',
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setGalleryUploading(true);
    const { photo, error } = await uploadGalleryPhoto(result.assets[0].uri);
    if (error || !photo) {
      Alert.alert('Upload failed', error ?? 'Something went wrong');
    } else {
      setGallery(prev => [...prev, photo]);
    }
    setGalleryUploading(false);
  }

  async function removeGalleryPhoto(photoId: string, url: string) {
    Alert.alert('Remove photo', 'Delete this photo from your gallery?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await deleteGalleryPhoto(photoId, url);
          if (!error) setGallery(prev => prev.filter(p => p.id !== photoId));
        },
      },
    ]);
  }

  // ── Achievements ────────────────────────────────────────────────────────────

  function startNewAchievement() {
    setEditingAchId('new');
    setAchForm({ title: '', value: '', context: '' });
  }

  function startEditAchievement(a: Achievement) {
    setEditingAchId(a.id);
    setAchForm({ title: a.title, value: a.value, context: a.context ?? '' });
  }

  function cancelEditAchievement() {
    setEditingAchId(null);
    setAchForm({ title: '', value: '', context: '' });
  }

  async function saveAchievement() {
    const title = achForm.title.trim();
    const value = achForm.value.trim();
    if (!title || !value) {
      Alert.alert('Missing fields', 'Title and value are required.');
      return;
    }
    setAchSaving(true);
    try {
      if (editingAchId === 'new') {
        const { achievement, error } = await createAchievement(achForm);
        if (error || !achievement) {
          Alert.alert('Couldn’t add achievement', error ?? 'Please try again');
          return;
        }
        setAchievements(prev => [...prev, achievement]);
      } else if (editingAchId) {
        const { error } = await updateAchievement(editingAchId, achForm);
        if (error) {
          Alert.alert('Couldn’t update achievement', error);
          return;
        }
        setAchievements(prev => prev.map(a =>
          a.id === editingAchId
            ? { ...a, title, value, context: achForm.context?.trim() || null }
            : a
        ));
      }
      cancelEditAchievement();
    } finally {
      setAchSaving(false);
    }
  }

  function confirmDeleteAchievement(a: Achievement) {
    Alert.alert('Remove achievement?', `Delete "${a.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await deleteAchievement(a.id);
          if (error) { Alert.alert('Delete failed', error); return; }
          setAchievements(prev => prev.filter(x => x.id !== a.id));
        },
      },
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

      // Save bio + cover (pro extended fields)
      const proUpdates: Parameters<typeof updateProProfile>[0] = {};
      const trimmedBio = bio.trim();
      proUpdates.bio = trimmedBio || null;
      if (coverChanged) {
        if (coverUri) {
          const { url: covUrl, error: covErr } = await uploadCover(coverUri);
          if (covErr) {
            Alert.alert('Cover upload failed', covErr);
            return;
          }
          proUpdates.cover_url = covUrl;
        } else {
          proUpdates.cover_url = null;
        }
      }
      if (Object.keys(proUpdates).length > 0) {
        const { error: proErr } = await updateProProfile(proUpdates);
        if (proErr) {
          Alert.alert('Save failed', proErr);
          return;
        }
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
                  onError={() => { setAvatarUri(null); setAvatarChanged(false); }}
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

          {/* ── Bio ────────────────────────────────────────── */}
          <SectionLabel label="Bio" />
          <View style={[
            styles.inputWrap, styles.bioWrap,
            focusedField === 'bio' && styles.inputWrapFocused,
          ]}>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={(t) => setBio(t.slice(0, 2000))}
              placeholder="Tell people about yourself…"
              placeholderTextColor={MUTED}
              multiline
              numberOfLines={8}
              maxLength={2000}
              onFocus={() => setFocusedField('bio')}
              onBlur={() => setFocusedField(null)}
            />
          </View>
          <Text style={styles.fieldHint}>{bio.length}/2000</Text>

          {/* ── Achievements (Pro users) ───────────────────────── */}
          {profile?.is_pro && (
            <>
              <View style={styles.achLabelRow}>
                <Text style={styles.sectionLabel}>ACHIEVEMENTS ({achievements.length}/{MAX_ACHIEVEMENTS})</Text>
                {achievements.length < MAX_ACHIEVEMENTS && editingAchId !== 'new' && (
                  <Pressable onPress={startNewAchievement} style={styles.achAddBtn} hitSlop={6}>
                    <Ionicons name="add" size={14} color={GOLD} />
                    <Text style={styles.achAddBtnText}>ADD</Text>
                  </Pressable>
                )}
              </View>

              {achievements.length === 0 && editingAchId !== 'new' && (
                <Text style={styles.fieldHint}>Add up to 4 career highlights — e.g. PBs, podiums, titles.</Text>
              )}

              {achievements.map(a => (
                <View key={a.id}>
                  {editingAchId === a.id ? (
                    <AchievementEditor
                      form={achForm}
                      setForm={setAchForm}
                      saving={achSaving}
                      onSave={saveAchievement}
                      onCancel={cancelEditAchievement}
                    />
                  ) : (
                    <Pressable style={styles.achRow} onPress={() => startEditAchievement(a)}>
                      <Ionicons name="trophy" size={14} color={GOLD} style={{ opacity: 0.75 }} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.achRowTitle} numberOfLines={1}>{a.title.toUpperCase()}</Text>
                        <Text style={styles.achRowValue} numberOfLines={1}>{a.value}</Text>
                        {a.context ? <Text style={styles.achRowContext} numberOfLines={1}>{a.context}</Text> : null}
                      </View>
                      <Pressable onPress={() => confirmDeleteAchievement(a)} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={MUTED} />
                      </Pressable>
                    </Pressable>
                  )}
                </View>
              ))}

              {editingAchId === 'new' && (
                <AchievementEditor
                  form={achForm}
                  setForm={setAchForm}
                  saving={achSaving}
                  onSave={saveAchievement}
                  onCancel={cancelEditAchievement}
                />
              )}
            </>
          )}

          {/* ── Cover photo (Pro users) ────────────────────────── */}
          {profile?.is_pro && (
            <>
              <SectionLabel label="Cover Photo" />
              <Pressable style={styles.coverWrap} onPress={pickCover}>
                {coverUri ? (
                  <Image source={{ uri: coverUri }} style={styles.coverImage} contentFit="cover" />
                ) : (
                  <View style={styles.coverPlaceholder}>
                    <Ionicons name="image-outline" size={28} color={MUTED} />
                    <Text style={styles.coverHint}>Tap to add a cover photo</Text>
                  </View>
                )}
                {coverUri && (
                  <Pressable
                    style={styles.coverRemove}
                    onPress={() => { setCoverUri(null); setCoverChanged(true); }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={22} color={TEXT} />
                  </Pressable>
                )}
              </Pressable>
            </>
          )}

          {/* ── Gallery (Pro users) ────────────────────────────── */}
          {profile?.is_pro && (
            <>
              <SectionLabel label={`Gallery (${gallery.length}/${MAX_GALLERY})`} />
              <View style={styles.galleryGrid}>
                {gallery.map((photo) => (
                  <View key={photo.id} style={styles.galleryThumbWrap}>
                    <Image source={{ uri: photo.url }} style={styles.galleryThumb} contentFit="cover" />
                    <Pressable
                      style={styles.galleryRemove}
                      onPress={() => removeGalleryPhoto(photo.id, photo.url)}
                      hitSlop={4}
                    >
                      <Ionicons name="close-circle" size={20} color={TEXT} />
                    </Pressable>
                  </View>
                ))}
                {gallery.length < MAX_GALLERY && (
                  <Pressable style={styles.galleryAdd} onPress={pickGalleryPhoto} disabled={galleryUploading}>
                    {galleryUploading ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <Ionicons name="add" size={24} color={MUTED} />
                    )}
                  </Pressable>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function AchievementEditor({
  form, setForm, saving, onSave, onCancel,
}: {
  form: AchievementInput;
  setForm: (f: AchievementInput) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.achEditor}>
      <View style={styles.achEditorField}>
        <Text style={styles.achEditorLabel}>TITLE</Text>
        <TextInput
          style={styles.achEditorInput}
          value={form.title}
          onChangeText={t => setForm({ ...form, title: t.slice(0, 60) })}
          placeholder="Women's Pro Solo"
          placeholderTextColor={MUTED}
          maxLength={60}
        />
      </View>
      <View style={styles.achEditorField}>
        <Text style={styles.achEditorLabel}>VALUE</Text>
        <TextInput
          style={styles.achEditorInput}
          value={form.value}
          onChangeText={t => setForm({ ...form, value: t.slice(0, 40) })}
          placeholder="01:09:30"
          placeholderTextColor={MUTED}
          maxLength={40}
        />
      </View>
      <View style={styles.achEditorField}>
        <Text style={styles.achEditorLabel}>CONTEXT (OPTIONAL)</Text>
        <TextInput
          style={styles.achEditorInput}
          value={form.context ?? ''}
          onChangeText={t => setForm({ ...form, context: t.slice(0, 60) })}
          placeholder="Toulouse · 2024"
          placeholderTextColor={MUTED}
          maxLength={60}
        />
      </View>
      <View style={styles.achEditorActions}>
        <Pressable onPress={onCancel} style={styles.achCancelBtn} hitSlop={6}>
          <Text style={styles.achCancelText}>CANCEL</Text>
        </Pressable>
        <Pressable onPress={onSave} disabled={saving} style={[styles.achSaveBtn, saving && { opacity: 0.5 }]} hitSlop={6}>
          {saving ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Text style={styles.achSaveText}>SAVE</Text>}
        </Pressable>
      </View>
    </View>
  );
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

  // Bio
  bioWrap: { alignItems: 'flex-start', paddingVertical: 10 },
  bioInput: { minHeight: 72, textAlignVertical: 'top' },

  // Cover photo
  coverWrap: {
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: INPUT_BORDER,
    height: 110,
  },
  coverImage: { width: '100%', height: '100%' },
  coverPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  coverHint: { fontSize: 12, fontWeight: '300', color: MUTED },
  coverRemove: {
    position: 'absolute', top: 8, right: 8,
  },

  // Achievements
  achLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 12, paddingBottom: 4, paddingHorizontal: 2,
  },
  achAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)',
    backgroundColor: 'rgba(232,210,0,0.08)',
  },
  achAddBtnText: { fontSize: 9, fontWeight: '700', color: GOLD, letterSpacing: 1.5 },
  achRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12,
    borderLeftWidth: 2, borderLeftColor: GOLD,
    backgroundColor: 'rgba(232,210,0,0.04)',
    marginBottom: 6,
  },
  achRowTitle: { fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.75, letterSpacing: 1.2 },
  achRowValue: { fontSize: 15, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
  achRowContext: { fontSize: 11, fontWeight: '300', color: DIM },
  achEditor: {
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)',
    paddingHorizontal: 14, paddingVertical: 14, gap: 12, marginBottom: 6,
  },
  achEditorField: { gap: 6 },
  achEditorLabel: { fontSize: 8, fontWeight: '700', color: DIM, letterSpacing: 1.5 },
  achEditorInput: {
    fontSize: 14, fontWeight: '300', color: TEXT,
    borderBottomWidth: 1, borderBottomColor: INPUT_BORDER,
    paddingVertical: 6, paddingHorizontal: 0,
  },
  achEditorActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4,
  },
  achCancelBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: INPUT_BORDER,
  },
  achCancelText: { fontSize: 10, fontWeight: '600', color: DIM, letterSpacing: 1.2 },
  achSaveBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', minWidth: 72,
  },
  achSaveText: { fontSize: 10, fontWeight: '700', color: '#0a0a0a', letterSpacing: 1.2 },

  // Gallery
  galleryGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4,
  },
  galleryThumbWrap: { position: 'relative' },
  galleryThumb: { width: 88, height: 88, borderRadius: 10 },
  galleryRemove: { position: 'absolute', top: -6, right: -6 },
  galleryAdd: {
    width: 88, height: 88, borderRadius: 10,
    borderWidth: 1, borderColor: INPUT_BORDER, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
});
