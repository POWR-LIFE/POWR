import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import GeometricBackground from '@/components/GeometricBackground';
import { fontFamily } from '@/constants/tokens';
import { PENDING_JOIN_KEY } from '@/lib/social/inviteLinks';
import { getSessionUser, supabase } from '@/lib/supabase';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';

/**
 * Landing screen for challenge invite links (powr://join-challenge?token=…,
 * reached from https://powr.life/c/<token> via the /app smart-link). Signed-in
 * users are joined server-side (respond-shared-challenge `join` — which also
 * makes them friends with the creator) and dropped straight onto the challenge.
 * No session yet → the token is stashed and the auth flow runs first; Home
 * redeems the stash on the next signed-in mount, so install → sign up → land
 * in the challenge works without tapping the link twice.
 */
export default function JoinChallengeScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const t = typeof token === 'string' ? token : null;
      if (!t) { setError('This invite link is missing its code.'); return; }

      const user = await getSessionUser().catch(() => null);
      if (!user) {
        await AsyncStorage.setItem(PENDING_JOIN_KEY, t).catch(() => {});
        router.replace('/');
        return;
      }

      const { data, error: fnErr } = await supabase.functions.invoke('respond-shared-challenge', {
        body: { action: 'join', invite_token: t },
      });
      // supabase-js surfaces non-2xx as FunctionsHttpError with the body on
      // `context` — pull the server's message out so caps read as themselves,
      // not as a generic failure.
      if (fnErr || !data?.ok) {
        let message = 'Something went wrong joining this challenge.';
        try {
          const body = fnErr && 'context' in (fnErr as any) ? await (fnErr as any).context.json() : data;
          if (body?.error) message = body.error;
        } catch { /* keep the generic message */ }
        setError(message);
        return;
      }
      router.replace({ pathname: '/shared-challenge', params: { id: data.challenge_id } });
    })();
  }, [token, router]);

  return (
    <View style={styles.screen}>
      <GeometricBackground />
      {error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={34} color={SECONDARY} />
          <Text style={styles.errorTitle}>Couldn’t join</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable style={styles.homeBtn} onPress={() => router.replace('/')}>
            <Text style={styles.homeBtnText}>Go to Home</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} />
          <Text style={styles.loadingText}>Joining the challenge…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d0d0d' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  loadingText: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY },
  errorTitle: { fontFamily: fontFamily.light, fontSize: 20, color: TEXT },
  errorBody: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, textAlign: 'center', lineHeight: 19 },
  homeBtn: { marginTop: 10, backgroundColor: GOLD, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28 },
  homeBtnText: { fontFamily: fontFamily.semiBold, fontSize: 13, color: '#0a0a0a', letterSpacing: 0.5 },
});
