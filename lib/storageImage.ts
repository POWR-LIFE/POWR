/**
 * Supabase Storage image-transform CDN helpers.
 *
 * Reward hero images are uploaded at full resolution (1–5 MB); rendering them
 * raw is what made image-heavy screens slow on cellular. Rewriting the public
 * object URL to the render endpoint serves a resized copy (~10× smaller).
 *
 * Always pass BOTH width and height with resize=contain — a width-only
 * transform squashes the image instead of scaling it. `contain` preserves the
 * aspect ratio, so the box only caps dimensions and `contentFit` on the
 * consuming <Image> still decides the crop.
 */

const OBJECT_PATH = '/storage/v1/object/public/';
const RENDER_PATH = '/storage/v1/render/image/public/';

export function storageImage(
  url: string | null | undefined,
  width: number,
  height: number,
): string | null {
  if (!url) return null;
  const idx = url.indexOf(OBJECT_PATH);
  if (idx === -1) return url; // not a Supabase storage URL — leave untouched
  const origin = url.slice(0, idx);
  const path = url.slice(idx + OBJECT_PATH.length);
  return `${origin}${RENDER_PATH}${path}?width=${width}&height=${height}&resize=contain`;
}

// One shared spec per image role, so every surface (wallet card, share card)
// requests the identical URL and reuses the same expo-image cache entry.

/** Reward hero/background images. */
export const rewardHeroUri = (url: string | null | undefined) => storageImage(url, 1080, 1080);

/** Reward/partner logos. */
export const rewardLogoUri = (url: string | null | undefined) => storageImage(url, 512, 512);

/** Live-event prize thumbnails (League ticket rows, register sheet). */
export const prizeImageUri = (url: string | null | undefined) => storageImage(url, 256, 256);
