import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { getFormatLocale } from '@/lib/i18n';
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

// Labels, questions and answers are catalog keys, resolved at render. The
// category id is what's stored on the ticket, never the label.
interface Category { id: string; label: string; icon: keyof typeof Ionicons.glyphMap; }

const CATEGORIES: Category[] = [
  { id: 'points_rewards', label: 'help:categories.pointsRewards', icon: 'trophy-outline'      },
  { id: 'account',        label: 'help:categories.account',       icon: 'person-outline'      },
  { id: 'health_sync',    label: 'help:categories.healthSync',    icon: 'heart-outline'       },
  { id: 'gym_checkin',    label: 'help:categories.gymCheckin',    icon: 'location-outline'    },
  { id: 'challenges',     label: 'help:categories.challenges',    icon: 'flag-outline'        },
  { id: 'technical',      label: 'help:categories.technical',     icon: 'build-outline'       },
  { id: 'feedback',       label: 'help:categories.feedback',      icon: 'chatbubble-outline'  },
];

interface FaqSection { label: string; items: { q: string; a: string }[]; }

const FAQ_SECTIONS: FaqSection[] = [
  {
    label: 'help:faq.points.label',
    items: [
      { q: 'help:faq.points.earn.q',     a: 'help:faq.points.earn.a' },
      { q: 'help:faq.points.expire.q',   a: 'help:faq.points.expire.a' },
      { q: 'help:faq.points.redeem.q',   a: 'help:faq.points.redeem.a' },
      { q: 'help:faq.points.transfer.q', a: 'help:faq.points.transfer.a' },
    ],
  },
  {
    label: 'help:faq.gym.label',
    items: [
      { q: 'help:faq.gym.howItWorks.q', a: 'help:faq.gym.howItWorks.a' },
      { q: 'help:faq.gym.noPoints.q',   a: 'help:faq.gym.noPoints.a' },
      { q: 'help:faq.gym.perDay.q',     a: 'help:faq.gym.perDay.a' },
    ],
  },
  {
    label: 'help:faq.health.label',
    items: [
      { q: 'help:faq.health.sources.q',         a: 'help:faq.health.sources.a' },
      { q: 'help:faq.health.stepsNotSyncing.q', a: 'help:faq.health.stepsNotSyncing.a' },
      { q: 'help:faq.health.noWearable.q',      a: 'help:faq.health.noWearable.a' },
      { q: 'help:faq.health.battery.q',         a: 'help:faq.health.battery.a' },
    ],
  },
  {
    label: 'help:faq.account.label',
    items: [
      { q: 'help:faq.account.changeEmail.q',   a: 'help:faq.account.changeEmail.a' },
      { q: 'help:faq.account.healthShared.q',  a: 'help:faq.account.healthShared.a' },
      { q: 'help:faq.account.deleteAccount.q', a: 'help:faq.account.deleteAccount.a' },
      { q: 'help:faq.account.leaderboard.q',   a: 'help:faq.account.leaderboard.a' },
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
  open:        'help:tickets.status.open',
  in_progress: 'help:tickets.status.inProgress',
  resolved:    'help:tickets.status.resolved',
  closed:      'help:tickets.status.closed',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HelpCentreScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();

  const [tab, setTab] = useState<Tab>('faq');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={MUTED} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('help:title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['faq', 'contact', 'tickets'] as Tab[]).map(id => (
          <Pressable key={id} style={[styles.tabBtn, tab === id && styles.tabBtnActive]} onPress={() => setTab(id)}>
            <Text style={[styles.tabLabel, tab === id && styles.tabLabelActive]}>
              {id === 'faq' ? t('help:tabs.faq') : id === 'contact' ? t('help:tabs.contact') : t('help:tabs.tickets')}
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
  const { t } = useTranslation();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {FAQ_SECTIONS.map((section) => (
        <View key={section.label}>
          <Text style={styles.sectionLabel}>{t(section.label).toUpperCase()}</Text>
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
                    <Text style={styles.faqQ}>{t(item.q)}</Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color={DIM}
                    />
                  </Pressable>
                  {isOpen && (
                    <View style={styles.faqAnswer}>
                      <Text style={styles.faqA}>{t(item.a)}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}

      <Text style={styles.hint}>{t('help:faq.stillStuck')}</Text>
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
  const { t } = useTranslation();

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
      Alert.alert(t('help:contact.errorTitle'), t('help:contact.errorBody'));
    } else {
      Alert.alert(t('help:contact.sentTitle'), t('help:contact.sentBody'), [
        { text: t('common:actions.ok'), onPress: onSent },
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
        <Text style={styles.sectionLabel}>{t('help:contact.whatHelp')}</Text>
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
                {t(cat.label)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Subject */}
        <Text style={styles.sectionLabel}>{t('help:contact.subject')}</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder={t('help:contact.subjectPlaceholder')}
            placeholderTextColor={DIM}
            value={subject}
            onChangeText={setSubject}
            maxLength={120}
            returnKeyType="next"
          />
        </View>

        {/* Message */}
        <Text style={styles.sectionLabel}>{t('help:contact.message')}</Text>
        <View style={[styles.inputWrap, styles.textAreaWrap]}>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={t('help:contact.messagePlaceholder')}
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
            : <Text style={styles.submitLabel}>{t('help:contact.send')}</Text>}
        </Pressable>

        <Text style={styles.hint}>{t('help:contact.responseTime')}</Text>
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
  const { t } = useTranslation();

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

  const categoryLabel = (id: string) => {
    const label = CATEGORIES.find(c => c.id === id)?.label;
    return label ? t(label) : id;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionLabel}>{t('help:tickets.title')}</Text>

      {loading && (
        <View style={styles.emptyState}>
          <ActivityIndicator color={GOLD} />
        </View>
      )}

      {!loading && tickets.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubble-ellipses-outline" size={40} color={DIM} />
          <Text style={styles.emptyText}>{t('help:tickets.emptyTitle')}</Text>
          <Text style={styles.emptyHint}>{t('help:tickets.emptyHint')}</Text>
        </View>
      )}

      {!loading && tickets.length > 0 && (
        <View style={styles.card}>
          {tickets.map((ticket, idx) => (
            <View key={ticket.id}>
              {idx > 0 && <View style={styles.divider} />}
              <Pressable
                style={({ pressed }) => [styles.ticketRow, pressed && { opacity: 0.7 }]}
                onPress={() => setExpanded(expanded === ticket.id ? null : ticket.id)}
              >
                <View style={styles.ticketMain}>
                  <View style={styles.ticketTopRow}>
                    <Text style={styles.ticketSubject} numberOfLines={1}>{ticket.subject}</Text>
                    <View style={[styles.statusBadge, { borderColor: STATUS_COLOR[ticket.status] ?? DIM }]}>
                      <Text style={[styles.statusText, { color: STATUS_COLOR[ticket.status] ?? DIM }]}>
                        {STATUS_LABEL[ticket.status] ? t(STATUS_LABEL[ticket.status]) : ticket.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.ticketMeta}>{categoryLabel(ticket.category)} · {formatDate(ticket.created_at)}</Text>
                </View>
                <Ionicons
                  name={expanded === ticket.id ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={DIM}
                />
              </Pressable>

              {expanded === ticket.id && (
                <View style={styles.ticketDetail}>
                  <Text style={styles.ticketMessage}>{ticket.message}</Text>
                  {ticket.admin_reply ? (
                    <View style={styles.replyBubble}>
                      <Text style={styles.replyLabel}>{t('help:tickets.supportName')}</Text>
                      <Text style={styles.replyText}>{ticket.admin_reply}</Text>
                    </View>
                  ) : (
                    <Text style={styles.awaitingText}>{t('help:tickets.awaiting')}</Text>
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
