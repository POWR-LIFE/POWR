import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { fontFamily } from '@/constants/tokens';
import { useFriends } from '@/hooks/useFriends';
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
}: {
  friend: Friend;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Avatar friend={friend} size={42} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{friend.displayName}</Text>
        <Text style={styles.handle}>{subtitle ?? `@${friend.username}`}</Text>
      </View>
      {right}
    </View>
  );
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    friends,
    incoming,
    outgoing,
    search,
    sendRequest,
    acceptRequest,
    declineRequest,
    removeFriend,
  } = useFriends();

  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const results = search(query);

  const handleSend = (f: Friend) => {
    sendRequest(f);
    setRequested((prev) => new Set(prev).add(f.id));
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>FRIENDS</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={MUTED} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Add by username"
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
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
            <Text style={styles.sectionLabel}>SEARCH RESULTS</Text>
            {results.length === 0 ? (
              <Text style={styles.emptyLine}>No one found for “{query.trim()}”.</Text>
            ) : (
              <View style={styles.card}>
                {results.map((f, i) => (
                  <View key={f.id} style={[i > 0 && styles.divider]}>
                    <PersonRow
                      friend={f}
                      right={
                        requested.has(f.id) ? (
                          <Text style={styles.requestedText}>Requested</Text>
                        ) : (
                          <Pressable style={styles.addBtn} onPress={() => handleSend(f)}>
                            <Ionicons name="person-add" size={13} color="#0a0a0a" />
                            <Text style={styles.addBtnText}>Add</Text>
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
            <Text style={styles.sectionLabel}>REQUESTS · {incoming.length}</Text>
            <View style={styles.card}>
              {incoming.map((f, i) => (
                <View key={f.id} style={[i > 0 && styles.divider]}>
                  <PersonRow
                    friend={f}
                    subtitle={`@${f.username} · wants to connect`}
                    right={
                      <View style={styles.reqActions}>
                        <Pressable style={styles.acceptBtn} onPress={() => acceptRequest(f.id)}>
                          <Ionicons name="checkmark" size={16} color="#0a0a0a" />
                        </Pressable>
                        <Pressable style={styles.declineBtn} onPress={() => declineRequest(f.id)}>
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
          <Text style={styles.sectionLabel}>FRIENDS · {friends.length}</Text>
          {friends.length === 0 ? (
            <Text style={styles.emptyLine}>No friends yet — search by username to add some.</Text>
          ) : (
            <View style={styles.card}>
              {friends.map((f, i) => (
                <View key={f.id} style={[i > 0 && styles.divider]}>
                  <PersonRow
                    friend={f}
                    right={
                      <Pressable hitSlop={10} onPress={() => removeFriend(f.id)}>
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
            <Text style={styles.sectionLabel}>PENDING · {outgoing.length}</Text>
            <View style={styles.card}>
              {outgoing.map((f, i) => (
                <View key={f.id} style={[i > 0 && styles.divider]}>
                  <PersonRow friend={f} subtitle={`@${f.username}`} right={<Text style={styles.requestedText}>Sent</Text>} />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
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
