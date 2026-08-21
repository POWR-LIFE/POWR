import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const CARD_BG = '#111111';
const BORDER = '#222222';

export interface OpenBoardPromptProps {
  optedIn: boolean;
  /** How many challenges are waiting that this user could take. */
  teaserCount: number;
  /** How many board cards are currently on screen (opted-in users only). */
  boardCount: number;
  /** Turn the board on. Only called from the not-opted-in states. */
  onEnable: () => Promise<void>;
  /** Open the create sheet with the board post already ticked. */
  onPost: () => void;
}

/**
 * The board's way in.
 *
 * Without this the feature is unreachable: get_open_challenges returns nothing
 * until you have opted in, so a user who hasn't heard of the board sees no board,
 * and the only entry points were a Settings toggle and a checkbox three taps into
 * the create sheet. That is how a feature ships and silently does nothing.
 *
 * Three states, in descending order of persuasiveness:
 *   · people ARE waiting → say how many. A number is proof; a description isn't.
 *   · opted in, shelf empty → invite them to be first. This is NOT the "search
 *     found nobody" failure the board was designed to avoid — it's an ask with a
 *     concrete outcome, and it's the only thing that seeds a cold board.
 *   · not opted in, nothing waiting → the plain pitch, aimed at the ~2/3 of
 *     active users who have no friends to invite.
 */
export function OpenBoardPrompt({ optedIn, teaserCount, boardCount, onEnable, onPost }: OpenBoardPromptProps) {
  const [busy, setBusy] = useState(false);

  // Opted in with a populated shelf — the cards speak for themselves.
  if (optedIn && boardCount > 0) return null;

  const waiting = !optedIn && teaserCount > 0;
  const beFirst = optedIn && boardCount === 0;

  const press = async () => {
    if (busy) return;
    Haptics.selectionAsync();
    if (beFirst) { onPost(); return; }
    setBusy(true);
    try {
      await onEnable();
    } finally {
      setBusy(false);
    }
  };

  const title = waiting
    ? `${teaserCount} ${teaserCount === 1 ? 'member is' : 'members are'} waiting for a challenger`
    : beFirst
      ? 'Be first on the board'
      : 'No one to challenge yet?';

  const body = waiting
    ? 'Take one on and you race them for real. They see your first name and photo — nothing else.'
    : beFirst
      ? 'Post a challenge and any POWR member can take it. The clock starts when someone does, so you both race the same week.'
      : 'Post a challenge any POWR member can take, and see theirs. Your first name and photo, nothing else.';

  const cta = waiting ? 'Show me' : beFirst ? 'Post one' : 'Turn on the board';

  return (
    <Pressable
      onPress={press}
      disabled={busy}
      style={({ pressed }) => [styles.card, pressed && !busy && { opacity: 0.95 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${cta}`}
    >
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name={waiting ? 'people' : 'megaphone-outline'} size={15} color={GOLD} />
        </View>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
      </View>

      <Text style={styles.body}>{body}</Text>

      <View style={styles.ctaRow}>
        {busy ? (
          <ActivityIndicator size="small" color={GOLD} />
        ) : (
          <>
            <Text style={styles.ctaText}>{cta}</Text>
            <Ionicons name="arrow-forward" size={14} color={GOLD} />
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 10,
    justifyContent: 'space-between',
    minHeight: 180,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(232,210,0,0.10)',
  },
  title: { flex: 1, fontFamily: fontFamily.light, fontSize: 19, color: TEXT, letterSpacing: -0.3, lineHeight: 24 },
  body: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ctaText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD, letterSpacing: 0.2 },
});
