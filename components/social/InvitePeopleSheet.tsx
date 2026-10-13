import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import type { Friend } from '@/lib/social/types';
import { Avatar } from './Avatar';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const SHEET_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#262626';

const SCREEN_H = Dimensions.get('window').height;

export interface InvitePeopleSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The creator's accepted friends. */
  friends: Friend[];
  /** user_ids already live in the challenge (invited/accepted/completed) — filtered out. */
  alreadyInIds: Set<string>;
  /** Invite existing friends straight into the challenge. Returns count invited. */
  onInvite: (userIds: string[]) => Promise<number>;
  /** Username search over people you're NOT yet connected to (RPC-backed). */
  search: (query: string) => Promise<Friend[]>;
  /** Send a friend request to someone found via search (they must accept first). */
  sendRequest: (friend: Friend) => void;
}

/**
 * Creator-only "invite people into this challenge" bottom sheet. Two distinct
 * jobs, kept visually separate so they're never confused:
 *   1. Invite a friend  — pick from your accepted friends (minus those already
 *      in) and drop them straight into the challenge (invited state).
 *   2. Not friends yet?  — search someone new by username and send a friend
 *      request. They can only be invited once they've accepted the friendship,
 *      so this is a two-step path, labelled honestly.
 */
export function InvitePeopleSheet({
  visible, onClose, friends, alreadyInIds, onInvite, search, sendRequest,
}: InvitePeopleSheetProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const kbHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState<Set<string>>(new Set());
  const [invited, setInvited] = useState<Set<string>>(new Set());

  // Invitable friends: accepted, on Together, and not already in this challenge.
  const invitable = useMemo(
    () => friends.filter(
      (f) => f.togetherEnabled !== false && !alreadyInIds.has(f.id) && !invited.has(f.id),
    ),
    [friends, alreadyInIds, invited],
  );

  // Debounced username search over strangers (RPC excludes existing friends).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const r = await search(q);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, search]);

  const handleInvite = async (f: Friend) => {
    if (inviting.has(f.id)) return;
    Haptics.selectionAsync();
    setInviting((prev) => new Set(prev).add(f.id));
    try {
      await onInvite([f.id]);
      setInvited((prev) => new Set(prev).add(f.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setInviting((prev) => { const n = new Set(prev); n.delete(f.id); return n; });
    }
  };

  const handleRequest = (f: Friend) => {
    Haptics.selectionAsync();
    sendRequest(f);
    setRequested((prev) => new Set(prev).add(f.id));
  };

  // Android: the modal window doesn't resize for the keyboard, so lift the
  // sheet by the keyboard height ourselves and shrink the scroll body to match.
  // iOS still gets KeyboardAvoidingView's `padding`, which works there.
  const lift = Platform.OS === 'android' ? kbHeight : 0;
  const bodyMaxHeight = Math.max(160, SCREEN_H * 0.62 - lift);

  const handleClose = () => {
    setQuery('');
    setResults([]);
    setRequested(new Set());
    setInvited(new Set());
    setInviting(new Set());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View
          style={[
            styles.sheet,
            { paddingBottom: lift > 0 ? lift + 12 : Math.max(insets.bottom, 16) + 8 },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text style={styles.sheetTitle}>{t('social:invite.title')}</Text>
            <Pressable hitSlop={10} onPress={handleClose} accessibilityRole="button" accessibilityLabel={t('social:shared.close')}>
              <Ionicons name="close" size={22} color={MUTED} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: bodyMaxHeight }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 18, paddingBottom: 8 }}
          >
            {/* ── 1. Invite a friend ─────────────────────────────────────── */}
            <View style={{ gap: 10 }}>
              <Text style={styles.sectionLabel}>{t('social:invite.inviteAFriend')}</Text>
              {invitable.length === 0 ? (
                <Text style={styles.note}>
                  {friends.length === 0
                    ? t('social:invite.noFriends')
                    : t('social:invite.allIn')}
                </Text>
              ) : (
                <View style={styles.card}>
                  {invitable.map((f, i) => (
                    <View key={f.id} style={i > 0 ? styles.divider : undefined}>
                      <View style={styles.row}>
                        <Avatar friend={f} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name} numberOfLines={1}>{f.displayName}</Text>
                          <Text style={styles.userHandle} numberOfLines={1}>@{f.username}</Text>
                        </View>
                        <Pressable
                          style={[styles.primaryBtn, inviting.has(f.id) && styles.btnDisabled]}
                          onPress={() => handleInvite(f)}
                          disabled={inviting.has(f.id)}
                          accessibilityRole="button"
                          accessibilityLabel={t('social:shared.inviteName', { name: f.displayName })}
                        >
                          <Ionicons name="add" size={14} color="#0a0a0a" />
                          <Text style={styles.primaryBtnText}>{inviting.has(f.id) ? t('social:invite.inviting') : t('social:invite.invite')}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              {invited.size > 0 && (
                <Text style={styles.doneNote}>
                  {t('social:invite.sent', { count: invited.size })} {t('social:invite.willNotify')}
                </Text>
              )}
            </View>

            {/* ── 2. Not friends yet? ────────────────────────────────────── */}
            <View style={{ gap: 10 }}>
              <Text style={styles.sectionLabel}>{t('social:invite.notFriendsYet')}</Text>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={MUTED} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('social:shared.searchByUsername')}
                  placeholderTextColor={MUTED}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.searchInput}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
                />
                {query.length > 0 && (
                  <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={t('social:shared.clearSearch')}>
                    <Ionicons name="close-circle" size={16} color={MUTED} />
                  </Pressable>
                )}
              </View>

              {query.trim().length === 0 ? (
                <Text style={styles.note}>
                  {t('social:invite.searchIntro')}
                </Text>
              ) : query.trim().length < 2 ? (
                <Text style={styles.note}>{t('social:shared.typeMore')}</Text>
              ) : searching ? (
                <Text style={styles.note}>{t('social:shared.searching')}</Text>
              ) : results.length === 0 ? (
                <Text style={styles.note}>{t('social:shared.noResults', { query: query.trim() })}</Text>
              ) : (
                <View style={styles.card}>
                  {results.map((f, i) => (
                    <View key={f.id} style={i > 0 ? styles.divider : undefined}>
                      <View style={styles.row}>
                        <Avatar friend={f} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name} numberOfLines={1}>{f.displayName}</Text>
                          <Text style={styles.userHandle} numberOfLines={1}>@{f.username}</Text>
                        </View>
                        {requested.has(f.id) ? (
                          <Text style={styles.requestedText}>{t('social:shared.requested')}</Text>
                        ) : (
                          <Pressable
                            style={styles.ghostBtn}
                            onPress={() => handleRequest(f)}
                            accessibilityRole="button"
                            accessibilityLabel={t('social:shared.addName', { name: f.displayName })}
                          >
                            <Ionicons name="person-add" size={13} color={GOLD} />
                            <Text style={styles.ghostBtnText}>{t('social:shared.add')}</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {requested.size > 0 && (
                <Text style={styles.doneNote}>
                  {t('social:invite.requestSent')}
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '88%',
    gap: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: fontFamily.light, fontSize: 24, color: TEXT, letterSpacing: -0.4 },

  sectionLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontFamily: fontFamily.regular, fontSize: 14, color: TEXT, padding: 0 },

  note: { fontFamily: fontFamily.light, fontSize: 12.5, color: SECONDARY, lineHeight: 17, paddingHorizontal: 2 },
  doneNote: { fontFamily: fontFamily.light, fontSize: 11.5, color: SECONDARY, lineHeight: 16, paddingHorizontal: 2 },

  card: { backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  name: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  userHandle: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 1 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 7,
  },
  primaryBtnText: { fontFamily: fontFamily.bold, fontSize: 12, color: '#0a0a0a' },
  btnDisabled: { opacity: 0.5 },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)', borderRadius: 100, paddingHorizontal: 13, paddingVertical: 6,
  },
  ghostBtnText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD },
  requestedText: { fontFamily: fontFamily.medium, fontSize: 12, color: MUTED },
});
