import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
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

export interface FriendSearchSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Username search over people you're not yet connected to (RPC-backed). */
  search: (query: string) => Promise<Friend[]>;
  /** Send a friend request to someone found via search. */
  sendRequest: (friend: Friend) => void;
}

/**
 * Self-contained "add a friend by username" bottom sheet. Mirrors the focused
 * search view inside CreateChallengeSheet so add-friend can be surfaced from
 * anywhere (e.g. the shared-challenge detail screen) without a second
 * useFriends instance — the host passes through search + sendRequest.
 */
export function FriendSearchSheet({ visible, onClose, search, sendRequest }: FriendSearchSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // Debounced username search. The RPC already excludes you and anyone you're
  // already connected to, so every result is someone you can request. Cancels
  // in-flight results on fast typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await search(q);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, search]);

  const handleAdd = (f: Friend) => {
    Haptics.selectionAsync();
    sendRequest(f);
    setRequested((prev) => new Set(prev).add(f.id));
  };

  const handleClose = () => {
    setQuery('');
    setResults([]);
    setRequested(new Set());
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text style={styles.sheetTitle}>Add a friend</Text>
            <Pressable hitSlop={10} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={MUTED} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={MUTED} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search by username"
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {query.length > 0 && (
              <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={MUTED} />
              </Pressable>
            )}
          </View>

          <ScrollView
            style={styles.results}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
          >
            {query.trim().length === 0 ? (
              <Text style={styles.note}>
                Find people by username and send a friend request. Once they accept, you can take on challenges together.
              </Text>
            ) : query.trim().length < 2 ? (
              <Text style={styles.note}>Type at least 2 characters to search.</Text>
            ) : searching ? (
              <Text style={styles.note}>Searching…</Text>
            ) : results.length === 0 ? (
              <Text style={styles.note}>No one found for “{query.trim()}”.</Text>
            ) : (
              <View style={styles.resultsCard}>
                {results.map((f, i) => (
                  <View key={f.id} style={i > 0 ? styles.resultDivider : undefined}>
                    <View style={styles.resultRow}>
                      <Avatar friend={f} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resultName} numberOfLines={1}>{f.displayName}</Text>
                        <Text style={styles.resultHandle} numberOfLines={1}>@{f.username}</Text>
                      </View>
                      {requested.has(f.id) ? (
                        <Text style={styles.requestedText}>Requested</Text>
                      ) : (
                        <Pressable
                          style={styles.addBtn}
                          onPress={() => handleAdd(f)}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${f.displayName}`}
                        >
                          <Ionicons name="person-add" size={13} color="#0a0a0a" />
                          <Text style={styles.addBtnText}>Add</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {requested.size > 0 && (
              <Text style={styles.requestedNote}>
                Request sent — we’ll let them know. Once they accept, they’ll show up in your friends.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
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

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontFamily: fontFamily.regular, fontSize: 14, color: TEXT, padding: 0 },

  results: { maxHeight: SCREEN_H * 0.5 },
  note: { fontFamily: fontFamily.light, fontSize: 12.5, color: SECONDARY, lineHeight: 17, paddingHorizontal: 2 },
  resultsCard: { backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12 },
  resultDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  resultName: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  resultHandle: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 7,
  },
  addBtnText: { fontFamily: fontFamily.bold, fontSize: 12, color: '#0a0a0a' },
  requestedText: { fontFamily: fontFamily.medium, fontSize: 12, color: MUTED },
  requestedNote: { fontFamily: fontFamily.light, fontSize: 11.5, color: SECONDARY, lineHeight: 16, paddingHorizontal: 2 },
});
