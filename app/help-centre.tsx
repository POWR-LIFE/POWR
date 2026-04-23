import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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
import GeometricBackground from '@/components/GeometricBackground';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.5)';
const DIM     = 'rgba(255,255,255,0.30)';
const GREEN   = '#4ade80';
const BLUE    = '#60a5fa';
const RED     = '#ef4444';

type Tab = 'faq' | 'contact' | 'tickets';

interface Category { id: string; label: string; icon: keyof typeof Ionicons.glyphMap; }

const CATEGORIES: Category[] = [
  { id: 'points_rewards', label: 'Points & Rewards',  icon: 'trophy-outline'      },
  { id: 'account',        label: 'Account & Profile', icon: 'person-outline'      },
  { id: 'health_sync',    label: 'Health & Sync',     icon: 'heart-outline'       },
  { id: 'gym_checkin',    label: 'Gym Check-in',      icon: 'location-outline'    },
  { id: 'challenges',     label: 'Challenges',        icon: 'flag-outline'        },
  { id: 'technical',      label: 'Technical Issue',   icon: 'build-outline'       },
  { id: 'feedback',       label: 'Feedback / Other',  icon: 'chatbubble-outline'  },
];

interface FaqSection { label: string; items: { q: string; a: string }[]; }

const FAQ_SECTIONS: FaqSection[] = [
  {
    label: 'Points & Rewards',
    items: [
      {
        q: 'How do I earn POWR Points?',
        a: 'Points are awarded for verified physical activity — gym check-ins at partner venues, walking steps tracked by your phone or wearable, logged workouts, and completing weekly challenges.',
      },
      {
        q: 'Do points expire?',
        a: 'Points may expire if your account is inactive for 12 consecutive months. As long as you stay active, your points are safe.',
      },
      {
        q: 'How do I redeem a reward?',
        a: 'Go to the Discover tab, find a reward you want, and tap Redeem. Your points will be deducted and a unique code will be shown. Present this to the partner business.',
      },
      {
        q: 'Can I transfer points to someone else?',
        a: 'Points are tied to your account and cannot be transferred or sold. Each user earns and redeems their own points.',
      },
    ],
  },
  {
    label: 'Gym & Check-ins',
    items: [
      {
        q: 'How do gym check-ins work?',
        a: 'When you arrive at a partner gym, POWR uses your location to detect the visit and automatically awards points. Make sure Location permission is enabled in Settings → Connections.',
      },
      {
        q: 'I visited the gym but didn\'t get points — why?',
        a: 'Check that Location Services is set to "While Using" for POWR (Settings → Connections). Also make sure the gym is a listed POWR partner. If the issue persists, log a manual session or contact us.',
      },
      {
        q: 'How many gym check-in points can I earn per day?',
        a: 'You can earn points for one gym check-in per day. Additional visits on the same day won\'t award duplicate points.',
      },
    ],
  },
  {
    label: 'Health & Sync',
    items: [
      {
        q: 'Which health sources are supported?',
        a: 'On iOS we read from Apple Health. On Android we use Google Health Connect. You can also connect Fitbit or WHOOP for richer data such as heart rate and sleep.',
      },
      {
        q: 'My steps are not syncing — what should I do?',
        a: "Check that your health source is connected under Settings → On your phone or Wearables. Also ensure POWR has the correct permissions in your device's Privacy or Health settings.",
      },
      {
        q: 'Can I use POWR without a wearable?',
        a: 'Yes. Your phone tracks steps and workouts natively via Apple Health or Google Health Connect — no wearable required.',
      },
      {
        q: 'Will POWR drain my battery?',
        a: 'POWR is designed to be efficient. Health data is synced in batches rather than continuously. Location is only used briefly during a gym check-in.',
      },
    ],
  },
  {
    label: 'Account & Privacy',
    items: [
      {
        q: 'How do I change my email or password?',
        a: 'Go to Settings → Account. Tap Email to update your address, or Change Password to update it directly in the app. If you\'ve forgotten your current password, tap "Send reset email" on the Change Password screen.',
      },
      {
        q: 'Is my health data shared with partners?',
        a: 'No. Your health data is never shared with partner businesses. We only share the minimum information required to fulfil a reward you choose to redeem (e.g. a redemption code).',
      },
      {
        q: 'How do I delete my account?',
        a: 'Go to Settings, scroll to the bottom, and tap Delete account. This permanently removes your profile and all associated data within 30 days.',
      },
      {
        q: 'How do I opt out of the leaderboard?',
        a: 'Go to Settings → Privacy and toggle off "Show on leaderboard". Your activity will remain private and you\'ll be removed from all rankings.',
      },
    ],
  },
];

const STATUS_COLOR: Record<string, string> = {
  open:        GOLD,
  in_progress: BLUE,
  resolved:    GREEN,
  closed:      DIM,
};
const STATUS_LABEL: Record<string, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  resolved:    'Resolved',
  closed:      'Closed',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HelpCentreScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>('faq');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={MUTED} />
        </Pressable>
        <Text style={styles.headerTitle}>Help Centre</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['faq', 'contact', 'tickets'] as Tab[]).map(t => (
          <Pressable key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'faq' ? 'FAQ' : t === 'contact' ? 'Contact Us' : 'My Tickets'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'faq'     && <FAQTab     insets={insets} />}
      {tab === 'contact' && <ContactTab insets={insets} user={user} onSent={() => setTab('tickets')} />}
      {tab === 'tickets' && <TicketsTab insets={insets} user={user} />}
    </View>
  );
}

// ─── FAQ Tab ──────────────────────────────────────────────────────────────────

function FAQTab({ insets }: { insets: ReturnType<typeof useSafeAreaInsets> }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {FAQ_SECTIONS.map((section) => (
        <View key={section.label}>
          <Text style={styles.sectionLabel}>{section.label.toUpperCase()}</Text>
          <View style={styles.card}>
            {section.items.map((item, idx) => {
              const key = `${section.label}-${idx}`;
              const isOpen = open === key;
              return (
                <View key={key}>
                  {idx > 0 && <View style={styles.divider} />}
                  <Pressable
                    style={({ pressed }) => [styles.faqRow, pressed && { opacity: 0.7 }]}
                    onPress={() => setOpen(isOpen ? null : key)}
                  >
                    <Text style={styles.faqQ}>{item.q}</Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color={DIM}
                    />
                  </Pressable>
                  {isOpen && (
                    <View style={styles.faqAnswer}>
                      <Text style={styles.faqA}>{item.a}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}

      <Text style={styles.hint}>Still stuck? Use the Contact Us tab and we'll get back to you.</Text>
    </ScrollView>
  );
}

// ─── Contact Tab ──────────────────────────────────────────────────────────────

function ContactTab({
  insets,
  user,
  onSent,
}: {
  insets: ReturnType<typeof useSafeAreaInsets>;
  user: ReturnType<typeof useAuth>['user'];
  onSent: () => void;
}) {
  const [category, setCategory] = useState<string>('');
  const [subject,  setSubject]  = useState('');
  const [message,  setMessage]  = useState('');
  const [sending,  setSending]  = useState(false);

  const canSubmit = category.length > 0 && subject.trim().length > 0 && message.trim().length > 10;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSending(true);
    const { error } = await supabase.from('support_tickets').insert({
      user_id:  user.id,
      email:    user.email ?? '',
      category,
      subject:  subject.trim(),
      message:  message.trim(),
    });
    setSending(false);
    if (error) {
      Alert.alert('Error', 'Could not send your message. Please try again.');
    } else {
      Alert.alert('Message sent', "We'll get back to you within one business day.", [
        { text: 'OK', onPress: onSent },
      ]);
    }
  };

  return (
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
        {/* Category */}
        <Text style={styles.sectionLabel}>WHAT CAN WE HELP WITH?</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.id}
              style={[styles.catChip, category === cat.id && styles.catChipActive]}
              onPress={() => setCategory(cat.id)}
            >
              <Ionicons
                name={cat.icon}
                size={15}
                color={category === cat.id ? '#0d0d0d' : MUTED}
              />
              <Text style={[styles.catLabel, category === cat.id && styles.catLabelActive]}>
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Subject */}
        <Text style={styles.sectionLabel}>SUBJECT</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Brief summary of your issue"
            placeholderTextColor={DIM}
            value={subject}
            onChangeText={setSubject}
            maxLength={120}
            returnKeyType="next"
          />
        </View>

        {/* Message */}
        <Text style={styles.sectionLabel}>MESSAGE</Text>
        <View style={[styles.inputWrap, styles.textAreaWrap]}>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe what happened and any steps you've already tried…"
            placeholderTextColor={DIM}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            maxLength={2000}
          />
          <Text style={styles.charCount}>{message.length} / 2000</Text>
        </View>

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            !canSubmit && styles.submitBtnDisabled,
            pressed && canSubmit && { opacity: 0.85 },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || sending}
        >
          {sending
            ? <ActivityIndicator color="#0d0d0d" size="small" />
            : <Text style={styles.submitLabel}>Send Message</Text>}
        </Pressable>

        <Text style={styles.hint}>We typically respond within one business day.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── My Tickets Tab ───────────────────────────────────────────────────────────

function TicketsTab({
  insets,
  user,
}: {
  insets: ReturnType<typeof useSafeAreaInsets>;
  user: ReturnType<typeof useAuth>['user'];
}) {
  const [tickets, setTickets]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setTickets(data ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const categoryLabel = (id: string) =>
    CATEGORIES.find(c => c.id === id)?.label ?? id;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionLabel}>YOUR SUPPORT TICKETS</Text>

      {loading && (
        <View style={styles.emptyState}>
          <ActivityIndicator color={GOLD} />
        </View>
      )}

      {!loading && tickets.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubble-ellipses-outline" size={40} color={DIM} />
          <Text style={styles.emptyText}>No tickets yet</Text>
          <Text style={styles.emptyHint}>Messages you send will appear here.</Text>
        </View>
      )}

      {!loading && tickets.length > 0 && (
        <View style={styles.card}>
          {tickets.map((t, idx) => (
            <View key={t.id}>
              {idx > 0 && <View style={styles.divider} />}
              <Pressable
                style={({ pressed }) => [styles.ticketRow, pressed && { opacity: 0.7 }]}
                onPress={() => setExpanded(expanded === t.id ? null : t.id)}
              >
                <View style={styles.ticketMain}>
                  <View style={styles.ticketTopRow}>
                    <Text style={styles.ticketSubject} numberOfLines={1}>{t.subject}</Text>
                    <View style={[styles.statusBadge, { borderColor: STATUS_COLOR[t.status] ?? DIM }]}>
                      <Text style={[styles.statusText, { color: STATUS_COLOR[t.status] ?? DIM }]}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.ticketMeta}>{categoryLabel(t.category)} · {formatDate(t.created_at)}</Text>
                </View>
                <Ionicons
                  name={expanded === t.id ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={DIM}
                />
              </Pressable>

              {expanded === t.id && (
                <View style={styles.ticketDetail}>
                  <Text style={styles.ticketMessage}>{t.message}</Text>
                  {t.admin_reply ? (
                    <View style={styles.replyBubble}>
                      <Text style={styles.replyLabel}>POWR Support</Text>
                      <Text style={styles.replyText}>{t.admin_reply}</Text>
                    </View>
                  ) : (
                    <Text style={styles.awaitingText}>Awaiting response…</Text>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: 0.2,
  },
  headerSpacer: { width: 36 },

  // ── Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: GOLD,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
  },
  tabLabelActive: {
    color: '#0d0d0d',
  },

  // ── Shared
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: DIM,
    letterSpacing: 1,
    marginBottom: 6,
    marginLeft: 2,
    marginTop: 16,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 16,
  },
  hint: {
    fontSize: 12,
    color: DIM,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },

  // ── FAQ
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  faqQ: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  faqAnswer: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  faqA: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 20,
  },

  // ── Contact form
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
  },
  catChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  catLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
  },
  catLabelActive: {
    color: '#0d0d0d',
  },
  inputWrap: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
    overflow: 'hidden',
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: TEXT,
  },
  textAreaWrap: {
    paddingBottom: 4,
  },
  textArea: {
    minHeight: 120,
  },
  charCount: {
    fontSize: 11,
    color: DIM,
    textAlign: 'right',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  submitBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.35,
  },
  submitLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0d0d0d',
  },

  // ── Tickets
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: MUTED,
  },
  emptyHint: {
    fontSize: 13,
    color: DIM,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 8,
  },
  ticketMain: { flex: 1 },
  ticketTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  ticketSubject: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  ticketMeta: {
    fontSize: 12,
    color: DIM,
  },
  ticketDetail: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  ticketMessage: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 20,
    marginBottom: 12,
  },
  replyBubble: {
    backgroundColor: 'rgba(232,210,0,0.07)',
    borderLeftWidth: 2,
    borderLeftColor: GOLD,
    borderRadius: 8,
    padding: 12,
  },
  replyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  replyText: {
    fontSize: 13,
    color: TEXT,
    lineHeight: 20,
  },
  awaitingText: {
    fontSize: 12,
    color: DIM,
    fontStyle: 'italic',
  },
});
