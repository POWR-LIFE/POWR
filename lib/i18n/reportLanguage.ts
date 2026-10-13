import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { getPreferredLanguage, languageReady } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Keep profiles.language current, so anything addressed to this person — a
 * push, an email — can be written in their language once it's translated.
 *
 * It records the language they READ (their pick in Settings, else the phone's),
 * not what the app can show today: a German phone reports "de" while POWR is
 * still English to them, so the senders can follow as soon as German exists,
 * and we can see how many people are waiting for it.
 *
 * Writes only on a change: the last value sent is remembered per user, so a
 * normal app open costs one AsyncStorage read and no network. Foreground only —
 * this rides the auth listener, which also fires on headless wakes, and a
 * network round trip there is what jams them (project_background_auth_freshness).
 */

const SYNCED_KEY = 'powr:language:synced';

export async function reportUserLanguage(userId: string): Promise<void> {
  try {
    if (AppState.currentState !== 'active') return;
    await languageReady;
    const language = getPreferredLanguage();
    // The column's check constraint: ISO 639, lower-case, never a full locale.
    if (!/^[a-z]{2,3}$/.test(language)) return;

    const marker = `${userId}:${language}`;
    if ((await AsyncStorage.getItem(SYNCED_KEY)) === marker) return;

    const { error } = await supabase.from('profiles').update({ language }).eq('id', userId);
    if (!error) await AsyncStorage.setItem(SYNCED_KEY, marker);
  } catch {
    // Best-effort: the next foreground tries again.
  }
}
