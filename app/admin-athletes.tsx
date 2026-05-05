import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';

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
const ORANGE  = '#f97316';

// ─── Types ─────────────────────────────────────────────────────────────────────

type ApplicationStatus = 'pending' | 'approved' | 'rejected';

interface Achievement {
  title: string;
  value: string;
  context?: string | null;
}

interface AthleteApplication {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  activity_preferences: string[];
  achievements: Achievement[];
  gallery_urls: string[];
  instagram_handle: string | null;
  website_url: string | null;
  status: ApplicationStatus;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  profile_id: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: ApplicationStatus) {
  if (status === 'approved') return GREEN;
  if (status === 'rejected') return RED;
  return ORANGE;
}

function statusLabel(status: ApplicationStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminAthletesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [applications, setApplications] = useState<AthleteApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('pending');

  const [selected, setSelected] = useState<AthleteApplication | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Admin guard
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

  const fetchApplications = useCallback(async () => {
    const query = supabase
      .from('athlete_applications')
      .select('*')
      .order('submitted_at', { ascending: false });
    const { data, error } = await (filter === 'all' ? query : query.eq('status', filter));
    if (!error && data) setApplications(data as AthleteApplication[]);
  }, [filter]);

  useEffect(() => {
    if (isAdmin) fetchApplications();
  }, [isAdmin, fetchApplications]);

  function openApplication(app: AthleteApplication) {
    setSelected(app);
    setReviewNotes(app.reviewer_notes ?? '');
  }

  async function handleDecision(decision: 'approved' | 'rejected') {
    if (!selected) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const updates: Partial<AthleteApplication> & { reviewed_by?: string; reviewed_at?: string } = {
      status: decision,
      reviewer_notes: reviewNotes.trim() || null,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    };

    if (decision === 'approved') {
      // Upsert the profile row and mark as pro
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', selected.profile_id ?? '')
        .maybeSingle();

      if (!existingProfile) {
        // No linked profile yet — this athlete doesn't have an account.
        // Create a stub profile record can't be done without auth user — store
        // the application as approved so it can be processed when they sign up.
        Alert.alert(
          'No account linked',
          'This athlete has no POWR account yet. The application will be marked approved and the profile will be updated when they sign up.',
        );
      } else {
        // Update the existing profile with the submitted data
        await supabase
          .from('profiles')
          .update({
            display_name: selected.display_name,
            bio: selected.bio,
            avatar_url: selected.avatar_url,
            cover_url: selected.cover_url,
            activity_preferences: selected.activity_preferences,
            is_pro: true,
          })
          .eq('id', selected.profile_id!);

        // Replace achievements
        await supabase.from('pro_achievements').delete().eq('user_id', selected.profile_id!);
        const achievementRows = selected.achievements.map((a, i) => ({
          user_id: selected.profile_id!,
          title: a.title,
          value: a.value,
          context: a.context ?? null,
          display_order: i,
        }));
        if (achievementRows.length > 0) {
          await supabase.from('pro_achievements').insert(achievementRows);
        }

        // Replace gallery photos
        await supabase.from('pro_gallery_photos').delete().eq('user_id', selected.profile_id!);
        const galleryRows = (selected.gallery_urls as string[]).map((url, i) => ({
          user_id: selected.profile_id!,
          url,
          display_order: i,
        }));
        if (galleryRows.length > 0) {
          await supabase.from('pro_gallery_photos').insert(galleryRows);
        }

        updates.profile_id = selected.profile_id!;
      }
    }

    const { error } = await supabase
      .from('athlete_applications')
      .update(updates)
      .eq('id', selected.id);

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSelected(null);
      fetchApplications();
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: MUTED, fontSize: 14 }}>Access denied</Text>
      </View>
    );
  }

  const pendingCount = applications.filter(a => a.status === 'pending').length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Athlete Applications</Text>
          {pendingCount > 0 && filter !== 'pending' && (
            <Text style={styles.pendingHint}>{pendingCount} pending review</Text>
          )}
        </View>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
          <Pressable
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {applications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No {filter === 'all' ? '' : filter} applications</Text>
          </View>
        ) : (
          applications.map(app => (
            <Pressable
              key={app.id}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
              onPress={() => openApplication(app)}
            >
              <View style={styles.cardRow}>
                {/* Avatar */}
                <View style={styles.avatar}>
                  {app.avatar_url ? (
                    <Image source={{ uri: app.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatarFallback]}>
                      <Text style={styles.avatarInitials}>
                        {app.display_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Info */}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.cardName} numberOfLines={1}>{app.display_name}</Text>
                  <Text style={styles.cardEmail} numberOfLines={1}>{app.email}</Text>
                  <View style={styles.tagsRow}>
                    {app.activity_preferences.slice(0, 3).map(pref => (
                      <View key={pref} style={styles.tag}>
                        <Text style={styles.tagText}>{pref}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Status + date */}
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[styles.statusBadge, { borderColor: `${statusColor(app.status)}40`, backgroundColor: `${statusColor(app.status)}12` }]}>
                    <Text style={[styles.statusText, { color: statusColor(app.status) }]}>
                      {statusLabel(app.status)}
                    </Text>
                  </View>
                  <Text style={styles.dateText}>{formatDate(app.submitted_at)}</Text>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Detail / review modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        {selected && (
          <ApplicationDetail
            application={selected}
            reviewNotes={reviewNotes}
            onNotesChange={setReviewNotes}
            saving={saving}
            onApprove={() => handleDecision('approved')}
            onReject={() => handleDecision('rejected')}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
    </View>
  );
}

// ─── Application Detail ───────────────────────────────────────────────────────

function ApplicationDetail({
  application: app,
  reviewNotes,
  onNotesChange,
  saving,
  onApprove,
  onReject,
  onClose,
}: {
  application: AthleteApplication;
  reviewNotes: string;
  onNotesChange: (v: string) => void;
  saving: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const isPending = app.status === 'pending';

  return (
    <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
      {/* Modal header */}
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Application</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color={DIM} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.modalContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover + avatar */}
        {app.cover_url && (
          <View style={styles.coverWrap}>
            <Image source={{ uri: app.cover_url }} style={styles.cover} contentFit="cover" />
          </View>
        )}

        <View style={styles.detailAvatarRow}>
          <View style={styles.detailAvatar}>
            {app.avatar_url ? (
              <Image source={{ uri: app.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.detailInitials}>
                  {app.display_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.detailName}>{app.display_name}</Text>
            {app.username && <Text style={styles.detailUsername}>@{app.username}</Text>}
            <View style={[styles.statusBadge, { alignSelf: 'flex-start', marginTop: 4, borderColor: `${statusColor(app.status)}40`, backgroundColor: `${statusColor(app.status)}12` }]}>
              <Text style={[styles.statusText, { color: statusColor(app.status) }]}>
                {statusLabel(app.status)}
              </Text>
            </View>
          </View>
        </View>

        {/* Core info */}
        <DetailSection label="CONTACT">
          <DetailRow icon="mail-outline" value={app.email} />
          {app.instagram_handle && <DetailRow icon="logo-instagram" value={`@${app.instagram_handle}`} />}
          {app.website_url && <DetailRow icon="globe-outline" value={app.website_url} />}
        </DetailSection>

        {app.bio && (
          <DetailSection label="BIO">
            <Text style={styles.bioText}>{app.bio}</Text>
          </DetailSection>
        )}

        <DetailSection label="SPORTS">
          <View style={styles.tagsRow}>
            {app.activity_preferences.map(pref => (
              <View key={pref} style={[styles.tag, { paddingHorizontal: 10, paddingVertical: 5 }]}>
                <Text style={[styles.tagText, { fontSize: 11 }]}>{pref}</Text>
              </View>
            ))}
          </View>
        </DetailSection>

        {app.achievements.length > 0 && (
          <DetailSection label="ACHIEVEMENTS">
            {app.achievements.map((a, i) => (
              <View key={i} style={styles.achievementRow}>
                <Text style={styles.achievementValue}>{a.value}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.achievementTitle}>{a.title}</Text>
                  {a.context && <Text style={styles.achievementContext}>{a.context}</Text>}
                </View>
              </View>
            ))}
          </DetailSection>
        )}

        {app.gallery_urls.length > 0 && (
          <DetailSection label={`GALLERY (${app.gallery_urls.length})`}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {(app.gallery_urls as string[]).map((url, i) => (
                <View key={i} style={styles.galleryThumb}>
                  <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" />
                </View>
              ))}
            </ScrollView>
          </DetailSection>
        )}

        <DetailSection label="SUBMITTED">
          <Text style={styles.metaText}>{formatDate(app.submitted_at)}</Text>
          {app.reviewed_at && (
            <Text style={styles.metaText}>Reviewed {formatDate(app.reviewed_at)}</Text>
          )}
        </DetailSection>

        {/* Reviewer notes */}
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>REVIEWER NOTES</Text>
          <TextInput
            style={styles.notesInput}
            value={reviewNotes}
            onChangeText={onNotesChange}
            placeholder="Optional internal notes…"
            placeholderTextColor={MUTED}
            multiline
            editable={!saving}
          />
        </View>

        {/* Action buttons — only shown for pending applications */}
        {isPending && (
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionBtn, styles.rejectBtn, saving && styles.actionBtnDisabled]}
              onPress={onReject}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color={RED} size="small" /> : (
                <>
                  <Ionicons name="close-circle-outline" size={18} color={RED} />
                  <Text style={[styles.actionBtnText, { color: RED }]}>Reject</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.approveBtn, saving && styles.actionBtnDisabled]}
              onPress={onApprove}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color={GREEN} size="small" /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={GREEN} />
                  <Text style={[styles.actionBtnText, { color: GREEN }]}>Approve</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {!isPending && (
          <View style={[styles.reviewedBanner, { borderColor: `${statusColor(app.status)}30`, backgroundColor: `${statusColor(app.status)}08` }]}>
            <Ionicons
              name={app.status === 'approved' ? 'checkmark-circle' : 'close-circle'}
              size={16}
              color={statusColor(app.status)}
            />
            <Text style={[styles.reviewedText, { color: statusColor(app.status) }]}>
              {app.status === 'approved' ? 'Approved' : 'Rejected'}{app.reviewed_at ? ` on ${formatDate(app.reviewed_at)}` : ''}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function DetailRow({ icon, value }: { icon: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon as any} size={14} color={MUTED} />
      <Text style={styles.detailRowText} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: '200', color: TEXT, letterSpacing: -0.3 },
  pendingHint: { fontSize: 11, color: ORANGE, marginTop: 2 },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16, paddingVertical: 8, gap: 8,
  },
  filterTab: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: BORDER,
  },
  filterTabActive: { borderColor: GOLD, backgroundColor: 'rgba(232,210,0,0.08)' },
  filterTabText: { fontSize: 9, fontWeight: '600', letterSpacing: 1.5, color: MUTED },
  filterTabTextActive: { color: GOLD },

  list: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },

  card: {
    borderRadius: 14,
    backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    padding: 14,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  avatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: 'rgba(40,40,40,0.8)' },
  avatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(40,40,40,0.8)' },
  avatarInitials: { fontSize: 16, fontWeight: '500', color: DIM },

  cardName: { fontSize: 15, fontWeight: '400', color: TEXT },
  cardEmail: { fontSize: 12, fontWeight: '300', color: DIM },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  tag: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1,
    borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tagText: { fontSize: 9, fontWeight: '500', letterSpacing: 0.8, color: MUTED, textTransform: 'uppercase' },

  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1,
  },
  statusText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  dateText: { fontSize: 10, color: MUTED },

  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontWeight: '300', color: MUTED },

  // ── Modal
  modal: { flex: 1, backgroundColor: BG },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalTitle: { fontSize: 18, fontWeight: '300', color: TEXT },
  modalContent: { paddingHorizontal: 20, paddingTop: 16, gap: 20, paddingBottom: 40 },

  coverWrap: { height: 140, borderRadius: 12, overflow: 'hidden', marginBottom: -30 },
  cover: { width: '100%', height: '100%' },

  detailAvatarRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingTop: 8 },
  detailAvatar: { width: 68, height: 68, borderRadius: 34, overflow: 'hidden', borderWidth: 2, borderColor: GOLD },
  detailInitials: { fontSize: 22, fontWeight: '400', color: DIM },
  detailName: { fontSize: 20, fontWeight: '300', color: TEXT, letterSpacing: -0.3 },
  detailUsername: { fontSize: 13, color: MUTED },

  detailSection: { gap: 8 },
  detailSectionLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: MUTED },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailRowText: { fontSize: 13, color: DIM, flex: 1 },

  bioText: { fontSize: 13, fontWeight: '300', color: DIM, lineHeight: 20 },

  achievementRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  achievementValue: { fontSize: 22, fontWeight: '200', color: GOLD, minWidth: 60, letterSpacing: -0.5 },
  achievementTitle: { fontSize: 13, fontWeight: '400', color: TEXT },
  achievementContext: { fontSize: 11, color: MUTED, marginTop: 2 },

  galleryThumb: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden' },

  metaText: { fontSize: 12, color: MUTED },

  notesSection: { gap: 8 },
  notesLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: MUTED },
  notesInput: {
    borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD_BG, color: TEXT,
    padding: 12, fontSize: 13, minHeight: 80,
    textAlignVertical: 'top',
  },

  actionRow: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  actionBtnDisabled: { opacity: 0.5 },
  rejectBtn: { borderColor: `${RED}30`, backgroundColor: `${RED}08` },
  approveBtn: { borderColor: `${GREEN}30`, backgroundColor: `${GREEN}08` },
  actionBtnText: { fontSize: 14, fontWeight: '500' },

  reviewedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  reviewedText: { fontSize: 13, fontWeight: '400' },
});
