// A reward brand's logo at the top of a partner email.
//
// It sits straight on the black hero, the way the app shows it on a reward
// card, because that is what brands design their upload for. Healthspan's
// logo is a white mark and wordmark over a gold "Elite", so on the white tile
// these emails used to have, only "Elite" showed.
//
// Email clients can't be trusted with max-width/max-height (Outlook ignores
// both), so the size is worked out here and written as width/height
// attributes. measureLogo() reads the real pixel size from the image header;
// without it the logo falls back to a fixed height.

import { esc, optimizeImage } from "./layout.ts";

export interface LogoSize { width: number; height: number }

// The box the logo fits inside, in CSS pixels. Tall marks hit the height,
// wide wordmarks the width.
const BOX_W = 220;
const BOX_H = 120;
const FALLBACK_H = 80;

/** The URL the email loads: a 2x copy no bigger than the box. */
export function logoSrc(url: string): string {
  return optimizeImage(url, { width: BOX_W * 2, height: BOX_H * 2, resize: "contain" });
}

/** The logo's <img>, centred, or "" when there is no usable https URL. */
export function brandLogoImg(url: string | null | undefined, alt: string, size?: LogoSize | null): string {
  const src = (url ?? "").trim();
  if (!/^https:\/\//.test(src)) return "";
  let dims: string;
  if (size && size.width > 0 && size.height > 0) {
    const scale = Math.min(BOX_W / size.width, BOX_H / size.height);
    const w = Math.max(1, Math.round(size.width * scale));
    const h = Math.max(1, Math.round(size.height * scale));
    dims = `width="${w}" height="${h}" style="display:block;width:${w}px;height:${h}px;margin:0 auto;border:0;"`;
  } else {
    dims = `height="${FALLBACK_H}" style="display:block;height:${FALLBACK_H}px;width:auto;max-width:100%;margin:0 auto;border:0;"`;
  }
  return `<img src="${esc(logoSrc(src))}" alt="${esc(alt)}" ${dims}>`;
}

/**
 * Pixel size of the logo, read from the image header (PNG, JPEG, GIF, WebP).
 * Null when it can't be fetched or read: the caller then gets the fixed-height
 * fallback rather than an error.
 */
export async function measureLogo(url: string | null | undefined): Promise<LogoSize | null> {
  const src = (url ?? "").trim();
  if (!/^https:\/\//.test(src)) return null;
  try {
    const res = await fetch(logoSrc(src), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return imageSize(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

export function imageSize(b: Uint8Array): LogoSize | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { width: u32be(16), height: u32be(20) };
  }
  if (b.length >= 10 && ascii(0, 3) === "GIF") {
    return { width: u16le(6), height: u16le(8) };
  }
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (kind === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the JPEG segments to the first start-of-frame marker.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}
