import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { fontFamily } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/social/types';

const GOLD = '#E8D200';
const GREEN = '#00CC66';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const CARD_BG = '#141414';
const BORDER = '#222222';

type Relationship = 'self' | 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted';

type Resolved = { friend: Friend; relationship: Relationship };

// What the CTA produced, once tapped.
type Outcome = 'pending' | 'accepted';

export default function AddFriendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string | string[] }>();
  const code = (Array.isArray(params.ref) ? params.ref[0] : params.ref)?.trim() ?? '';

  const [loading, setLoading] = useState(true);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  useEffect(() => {
    let active = true;
    if (!code) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc('get_profile_by_referral_code', { p_code: code });
      if (!active) return;
      const row = !error && Array.isArray(data) ? data[0] : null;
      if (row) {
        setResolved({
          friend: {
            id: row.id,
            username: row.username ?? '',
            displayName: row.display_name ?? row.username ?? 'POWR member',
            avatarUrl: row.avatar_url,
            status: 'accepted',
          },
          relationship: (row.relationship ?? 'none') as Relationship,
        });
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [code]);

  const act = useCallback(async () => {
    if (!resolved || acting) return;
    setActing(true);
    Haptics.selectionAsync();
    // They already asked us → accept; otherwise send a request. The edge function
    // also auto-accepts a `request` when there's mutual intent, so this is safe
    // even if the resolved relationship was a touch stale.
    const action = resolved.relationship === 'pending_incoming' ? 'accept' : 'request';
    const { data, error } = await supabase.functions.invoke('manage-friendship', {
      body: { action, target_user_id: resolved.friend.id },
    });
    setActing(false);
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const status = (data as { status?: string } | null)?.status;
    const result: Outcome = status === 'accepted' ? 'accepted' : 'pending';
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOutcome(result);
  }, [resolved, acting]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>ADD FRIEND</Text>
        <Pressable onPress={close} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={SECONDARY} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={GOLD} />
        ) : !resolved ? (
          <NotFound onDone={close} />
        ) : (
          <>
            <View style={styles.identity}>
              <Avatar friend={resolved.friend} size={72} />
              <Text style={styles.name}>{resolved.friend.displayName}</Text>
              {resolved.friend.username ? <Text style={styles.handle}>@{resolved.friend.username}</Text> : null}
            </View>

            <Outcomes
              relationship={resolved.relationship}
              outcome={outcome}
              acting={acting}
              onAct={act}
              onDone={close}
              onViewFriends={() => router.replace('/friends')}
            />
          </>
        )}
      </View>
    </View>
  );
}

function NotFound({ onDone }: { onDone: () => void }) {
  return (
    <View style={styles.stateBlock}>
      <View style={styles.stateIcon}>
        <Ionicons name="help-outline" size={28} color={MUTED} />
      </View>
      <Text style={styles.stateTitle}>Couldn’t find that person</Text>
      <Text style={styles.stateSub}>This code may be invalid or out of date. Ask them to show you their code again.</Text>
      <Pressable style={styles.ghostBtn} onPress={onDone}>
        <Text style={styles.ghostBtnText}>Done</Text>
      </Pressable>
    </View>
  );
}

function Outcomes({
  relationship,
  outcome,
  acting,
  onAct,
  onDone,
  onViewFriends,
}: {
  relationship: Relationship;
  outcome: Outcome | null;
  acting: boolean;
  onAct: () => void;
  onDone: () => void;
  onViewFriends: () => void;
}) {
  // Post-action confirmation takes over.
  if (outcome === 'accepted') {
    return <Confirmation tint={GREEN} icon="checkmark-circle" title="You're connected!" sub="You can now take on challenges together." cta="View friends" onCta={onViewFriends} />;
  }
  if (outcome === 'pending') {
    return <Confirmation tint={GOLD} icon="paper-plane" title="Request sent" sub="We'll let them know — you'll connect once they accept." cta="Done" onCta={onDone} />;
  }

  switch (relationship) {
    case 'self':
      return <Confirmation tint={SECONDARY} icon="person" title="That's you" sub="This is your own code — share it for a friend to scan." cta="Done" onCta={onDone} />;
    case 'accepted':
      return <Confirmation tint={GREEN} icon="checkmark-circle" title="Already friends" sub="You're already connected on POWR." cta="View friends" onCta={onViewFriends} />;
    case 'pending_outgoing':
      return <Confirmation tint={GOLD} icon="paper-plane-outline" title="Request pending" sub="You've already sent them a request — waiting on their reply." cta="Done" onCta={onDone} />;
    case 'pending_incoming':
      return (
        <Pressable style={[styles.primaryBtn, acting && styles.btnDisabled]} onPress={onAct} disabled={acting}>
          {acting ? <ActivityIndicator color="#0a0a0a" /> : (
            <>
              <Ionicons name="checkmark" size={18} color="#0a0a0a" />
              <Text style={styles.primaryBtnText}>Accept request</Text>
            </>
          )}
        </Pressable>
      );
    default:
      return (
        <Pressable style={[styles.primaryBtn, acting && styles.btnDisabled]} onPress={onAct} disabled={acting}>
          {acting ? <ActivityIndicator color="#0a0a0a" /> : (
            <>
              <Ionicons name="person-add" size={17} color="#0a0a0a" />
              <Text style={styles.primaryBtnText}>Add friend</Text>
            </>
          )}
        </Pressable>
      );
  }
}

function Confirmation({
  tint,
  icon,
  title,
  sub,
  cta,
  onCta,
}: {
  tint: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <View style={styles.stateBlock}>
      <View style={[styles.stateIcon, { borderColor: tint }]}>
        <Ionicons name={icon} size={28} color={tint} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateSub}>{sub}</Text>
      <Pressable style={styles.ghostBtn} onPress={onCta}>
        <Text style={styles.ghostBtnText}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 28 },

  identity: { alignItems: 'center', gap: 8 },
  name: { fontFamily: fontFamily.medium, fontSize: 20, color: TEXT },
  handle: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, marginTop: -4 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 32, height: 52, minWidth: 220,
  },
  primaryBtnText: { fontFamily: fontFamily.bold, fontSize: 15, color: '#0a0a0a' },
  btnDisabled: { opacity: 0.6 },

  stateBlock: { alignItems: 'center', gap: 12, maxWidth: 320 },
  stateIcon: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: CARD_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  stateTitle: { fontFamily: fontFamily.medium, fontSize: 18, color: TEXT, textAlign: 'center' },
  stateSub: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center', lineHeight: 20 },
  ghostBtn: { marginTop: 12, paddingHorizontal: 28, height: 48, borderRadius: 100, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT },
});
