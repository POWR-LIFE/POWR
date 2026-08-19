import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * "Keep the image" for every social card — share-stats, the wallet reward
 * card, the event prize card.
 *
 * Deliberately NOT a camera-roll write. The package that does that
 * (expo-media-library) injects READ_MEDIA_IMAGES/VIDEO into the Android
 * manifest, which is exactly what Google Play rejected POWR for in July 2026 —
 * see project memory `project_play_photo_video_policy_rejection`. Both routes
 * here need zero manifest permissions and ship over the air:
 *
 *   - Android: the Storage Access Framework. The member picks a folder once
 *     (the picker opens on Pictures); we remember it and write every later
 *     card straight there. Gallery apps index the folder, so the card shows
 *     up in Photos/Gallery without us ever holding a media permission.
 *   - iOS: the system share sheet, whose "Save Image" row IS the save. There
 *     is no way to jump past it without a Photos permission, so the screen
 *     tells the member which row to tap.
 *
 * Returns what actually happened so the screen can word its notice honestly.
 */
export type SaveCardResult = 'saved' | 'sheet' | 'cancelled' | 'unavailable';

/** Where the member chose to keep their cards (Android SAF directory URI). */
export const SAVE_DIR_KEY = '@powr/save_card_dir';

/** A filename that sorts sensibly and never collides: powr-<kind>-<stamp>.png */
export function cardFilename(kind: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const safeKind = kind.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
  return `powr-${safeKind}-${stamp}.png`;
}

export async function saveCardImage(uri: string, filename: string): Promise<SaveCardResult> {
  if (Platform.OS === 'android') return saveViaStorageAccessFramework(uri, filename);
  // iOS (and anything else with a share sheet): the sheet's Save Image row.
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Save Image' });
    return 'sheet';
  }
  return 'unavailable';
}

/** The notice a screen shows for each outcome; null = say nothing. */
export function saveCardNotice(result: SaveCardResult): string | null {
  switch (result) {
    case 'saved': return 'Saved to your phone.';
    case 'sheet': return 'Tap “Save Image” in the sheet to keep it.';
    case 'cancelled': return null;
    case 'unavailable': return 'Saving isn’t available on this device.';
  }
}

/** What to tell the member BEFORE the iOS sheet opens, so the hint is on screen while they look at it. */
export const SAVE_SHEET_HINT = 'Tap “Save Image” in the sheet to keep it.';

async function saveViaStorageAccessFramework(uri: string, filename: string): Promise<SaveCardResult> {
  const { StorageAccessFramework: SAF } = FileSystem;
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

  // A folder the member already chose: write there without asking again. If
  // that fails (folder deleted, grant revoked after a reinstall), forget it
  // and fall through to the picker rather than surfacing a raw SAF error.
  const remembered = await AsyncStorage.getItem(SAVE_DIR_KEY);
  if (remembered) {
    try {
      await writeInto(remembered, filename, base64);
      return 'saved';
    } catch {
      await AsyncStorage.removeItem(SAVE_DIR_KEY);
    }
  }

  // First time (or the old folder is gone): let them pick one, opening on
  // Pictures so the obvious choice is one tap away.
  let initial: string | null = null;
  try { initial = SAF.getUriForDirectoryInRoot('Pictures'); } catch { /* older Android — picker opens at root */ }
  const perm = await SAF.requestDirectoryPermissionsAsync(initial);
  if (!perm.granted) return 'cancelled';

  await writeInto(perm.directoryUri, filename, base64);
  await AsyncStorage.setItem(SAVE_DIR_KEY, perm.directoryUri);
  return 'saved';
}

async function writeInto(dirUri: string, filename: string, base64: string): Promise<void> {
  const { StorageAccessFramework: SAF } = FileSystem;
  const fileUri = await SAF.createFileAsync(dirUri, filename, 'image/png');
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
}
