import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { UserProfileSheet } from '@/components/UserProfileSheet';
import { fontFamily } from '@/constants/tokens';
import { useFriends } from '@/hooks/useFriends';
import type { FriendRelationship } from '@/lib/api/user';
import type { Friend } from '@/lib/social/types';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const DIM = 'rgba(255,255,255,0.5)';
const CARD_BG = '#141414';
const INPUT_BG = '#1A1A1A';
const BORDER = '#222222';

function PersonRow({
  friend,
  subtitle,
  right,
  onPress,
}: {
  friend: Friend;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowMain}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? t('social:shared.viewProfile', { name: friend.displayName }) : undefined}
      >
        <Avatar friend={friend} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{friend.displayName}</Text>
          <Text style={styles.handle}>{subtitle ?? `@${friend.username}`}</Text>
        </View>
      </Pressable>
      {right}
    </View>
  );
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const {
    friends,
    incoming,
    outgoing,
    search,
    sendRequest,
    acceptRequest,
    declineRequest,
    removeFriend,
    refresh,
  } = useFriends();

  // Re-pull on focus so a request sent from the scan/add-friend flow shows up.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);

  // Profile sheet — tap anyone to view them. We pass the relationship we already
  // know from the graph; search results are unknown, so the sheet resolves them.
  const [sheetUserId, setSheetUserId] = useState<string | null>(null);
  const [sheetRel, setSheetRel] = useState<FriendRelationship | undefined>(undefined);
  const openProfile = (userId: string, relationship?: FriendRelationship) => {
    setSheetRel(relationship);
    setSheetUserId(userId);
  };

  // Debounced username search (RPC). Cancels in-flight results on fast typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const r = await search(q);
      if (!cancelled) {
        setResults(r);
        setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, search]);

  const handleSend = (f: Friend) => {
    Haptics.selectionAsync();
    sendRequest(f);
    setRequested((prev) => new Set(prev).add(f.id));
  };

  const handleAccept = (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    acceptRequest(id);
  };

  const handleDecline = (id: string) => {
    Haptics.selectionAsync();
    declineRequest(id);
  };

  // Removing a friend is destructive and was a one-tap action — confirm first so
  // a stray tap on the "⋯" doesn't silently delete someone (and explain that any
  // shared challenges keep running, so it doesn't read as "this breaks things").
  const confirmRemove = (f: Friend) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      t('social:shared.removeFriend.title', { name: f.displayName }),
      t('social:shared.removeFriend.body'),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: t('social:shared.removeFriend.confirm'),
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            removeFriend(f.id);
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('common:actions.back')}>
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('social:friends.title')}</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/scan-friend')} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('social:shared.scanFriendCode')}>
            <Ionicons name="scan-outline" size={20} color={TEXT} />
          </Pressable>
          <Pressable onPress={() => router.push('/my-qr')} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('social:friends.showMyCode')}>
            <Ionicons name="qr-code-outline" size={19} color={TEXT} />
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={MUTED} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('social:friends.searchPlaceholder')}
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={t('social:shared.clearSearch')}>
            <Ionicons name="close-circle" size={16} color={MUTED} />
          </Pressable>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: insets.bottom + 32, gap: 22 }}
      >
        {/* Search results */}
        {query.trim().length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('social:friends.searchResults')}</Text>
            {query.trim().length < 2 ? (
              <Text style={styles.emptyLine}>{t('social:shared.typeMore')}</Text>
            ) : searching ? (
              <Text style={styles.emptyLine}>{t('social:shared.searching')}</Text>
            ) : results.length === 0 ? (
              <Text style={styles.emptyLine}>{t('social:shared.noResults', { query: query.trim() })}</Text>
            ) : (
              <View style={styles.card}>
                {results.map((f, i) => (
                  <View key={f.id} style={[i > 0 && styles.divider]}>
                    <PersonRow
                      friend={f}
                      onPress={() => openProfile(f.id)}
                      right={
                        requested.has(f.id) ? (
                          <Text style={styles.requestedText}>{t('social:shared.requested')}</Text>
                        ) : (
                          <Pressable style={styles.addBtn} onPress={() => handleSend(f)}>
                            <Ionicons name="person-add" size={13} color="#0a0a0a" />
                            <Text style={styles.addBtnText}>{t('social:shared.add')}</Text>
                          </Pressable>
                        )
                      }
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('social:friends.requests', { total: incoming.length })}</Text>
            <View style={styles.card}>
              {incoming.map((f, i) => (
                <View key={f.id} style={[i > 0 && styles.divider]}>
                  <PersonRow
                    friend={f}
                    subtitle={t('social:friends.wantsToConnect', { username: f.username })}
                    onPress={() => openProfile(f.id, 'pending_incoming')}
                    right={
                      <View style={styles.reqActions}>
                        <Pressable style={styles.acceptBtn} onPress={() => handleAccept(f.id)} accessibilityRole="button" accessibilityLabel={t('social:friends.acceptName', { name: f.displayName })}>
                          <Ionicons name="checkmark" size={16} color="#0a0a0a" />
                        </Pressable>
                        <Pressable style={styles.declineBtn} onPress={() => handleDecline(f.id)} accessibilityRole="button" accessibilityLabel={t('social:friends.declineName', { name: f.displayName })}>
                          <Ionicons name="close" size={16} color={SECONDARY} />
                        </Pressable>
                      </View>
                    }
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Friends */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('social:friends.friendsCount', { total: friends.length })}</Text>
          {friends.length === 0 ? (
            <Text style={styles.emptyLine}>{t('social:friends.empty')}</Text>
          ) : (
            <View style={styles.card}>
              {friends.map((f, i) => (
                <View key={f.id} style={[i > 0 && styles.divider]}>
                  <PersonRow
                    friend={f}
                    onPress={() => openProfile(f.id, 'accepted')}
                    right={
                      <Pressable
                        hitSlop={10}
                        onPress={() => confirmRemove(f)}
                        accessibilityRole="button"
                        accessibilityLabel={t('social:friends.removeName', { name: f.displayName })}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color={MUTED} />
                      </Pressable>
                    }
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Outgoing */}
        {outgoing.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('social:friends.pending', { total: outgoing.length })}</Text>
            <View style={styles.card}>
              {outgoing.map((f, i) => (
                <View key={f.id} style={[i > 0 && styles.divider]}>
                  <PersonRow friend={f} subtitle={`@${f.username}`} onPress={() => openProfile(f.id, 'pending_outgoing')} right={<Text style={styles.requestedText}>{t('social:friends.sent')}</Text>} />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <UserProfileSheet
        userId={sheetUserId}
        relationship={sheetRel}
        onChanged={refresh}
        onClose={() => setSheetUserId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 4,
    backgroundColor: INPUT_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontFamily: fontFamily.regular, fontSize: 14, color: TEXT, padding: 0 },

  section: { gap: 10 },
  sectionLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },
  emptyLine: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, lineHeight: 18 },

  card: { backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  handle: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 1 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 7,
  },
  addBtnText: { fontFamily: fontFamily.bold, fontSize: 12, color: '#0a0a0a' },
  requestedText: { fontFamily: fontFamily.medium, fontSize: 12, color: MUTED },

  reqActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
});
