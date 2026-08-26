import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * "Keep the image" for every social card — share-stats, the wallet reward
 * card, the event prize card.
 *
 * Both platforms save straight to the gallery via expo-media-library, which
 * is WRITE-ONLY here by design: the July 2026 Play rejection was for the
 * READ_MEDIA_* permissions its plugin declares, and android.blockedPermissions
 * strips them back out of the manifest (see project memory
 * `project_play_photo_video_policy_rejection`). iOS prompts only for the
 * add-only Photos permission. If the member declines — or the write fails —
 * we fall back to the OS share sheet, whose "Save Image" row still gets the
 * image kept.
 *
 * Returns what actually happened so the screen can word its notice honestly.
 */
export type SaveCardResult = 'saved' | 'sheet' | 'cancelled' | 'unavailable';

/**
 * ON since 2026-08-24: the native gallery save replaced the Android SAF route
 * that hung on-device (2026-08-19). Requires a build carrying expo-media-library
 * — flip OFF again if Save must ship to older binaries over the air.
 */
export const SAVE_CARD_ENABLED = true;

/** A filename that sorts sensibly and never collides: powr-<kind>-<stamp>.png */
export function cardFilename(kind: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const safeKind = kind.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
  return `powr-${safeKind}-${stamp}.png`;
}

export async function saveCardImage(uri: string, filename: string): Promise<SaveCardResult> {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    try {
      // writeOnly: iOS shows the add-only Photos prompt; Android 10+ needs no
      // runtime permission just to insert into MediaStore, so this resolves
      // granted without a dialog on modern devices.
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (perm.granted) {
        // The gallery names the asset after the file, so give the temp capture
        // its member-facing name before handing it over.
        const named = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.copyAsync({ from: uri, to: named });
        await MediaLibrary.saveToLibraryAsync(named);
        return 'saved';
      }
    } catch {
      // Fall through to the share sheet — a save the member can still finish
      // beats surfacing a raw MediaLibrary error.
    }
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Save Image' });
    return 'sheet';
  }
  return 'unavailable';
}

/** The notice a screen shows for each outcome; null = say nothing. */
export function saveCardNotice(result: SaveCardResult): string | null {
  switch (result) {
    case 'saved': return 'Saved to your Photos.';
    case 'sheet': return 'Tap “Save Image” in the sheet to keep it.';
    case 'cancelled': return null;
    case 'unavailable': return 'Saving isn’t available on this device.';
  }
}
