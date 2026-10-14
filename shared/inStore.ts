/**
 * In-store redemption: the pure helpers that the member app, the staff scan
 * page (landing-page /scan) and the database all have to agree on.
 * No React, no network, no platform crypto, so every runtime computes the
 * exact same strings.
 *
 * Rotating voucher code. While a voucher is open, the member's phone shows a
 * QR and a 6-character typed fallback that change every VOUCHER_STEP_SECONDS.
 * Both come from sha256(`${secret}:${step}`). The same derivation lives in SQL
 * (public.in_store_voucher_proof / in_store_typed_code). Keep the two in
 * lockstep: __tests__/inStore.test.ts pins the vectors the migration was
 * checked against.
 *
 * Shop stand. The printed counter stand carries a static key. The till tablet
 * in kiosk mode shows a key that rotates every STAND_STEP_SECONDS, derived from
 * the site's stand secret. The server accepts either.
 */

export const VOUCHER_STEP_SECONDS = 10;
export const STAND_STEP_SECONDS = 30;
/** 31 characters, no 0/O, 1/I/L: nothing staff can misread off a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const VOUCHER_QR_PREFIX = 'POWR-IS';
export const STAND_URL_BASE = 'https://powr.life/s/';

export type InStoreWhere = 'online' | 'in_store' | 'both';
export type InStoreCheck = 'staff_scan' | 'look' | 'till_barcode';
export type BarcodeFormat = 'ean13' | 'code128' | 'qr';

// ---------------------------------------------------------------------------
// sha256 (FIPS 180-4), UTF-8 input, lowercase hex output.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha256Bytes(text: string): Uint8Array {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Message length as a 64-bit big-endian integer (high word stays 0 below 512 MB).
  const hi = Math.floor(bitLen / 0x100000000);
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  bytes.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      W[t] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = H[i] >>> 24;
    out[i * 4 + 1] = (H[i] >>> 16) & 255;
    out[i * 4 + 2] = (H[i] >>> 8) & 255;
    out[i * 4 + 3] = H[i] & 255;
  }
  return out;
}

export function sha256Hex(text: string): string {
  let hex = '';
  for (const b of sha256Bytes(text)) hex += (b < 16 ? '0' : '') + b.toString(16);
  return hex;
}

// ---------------------------------------------------------------------------
// Rotating voucher code
// ---------------------------------------------------------------------------

export function codeStep(epochMs: number, stepSeconds = VOUCHER_STEP_SECONDS): number {
  return Math.floor(epochMs / 1000 / stepSeconds);
}

/** 16 hex chars: what the voucher QR carries for this step. */
export function voucherProof(secret: string, step: number): string {
  return sha256Hex(`${secret}:${step}`).slice(0, 16);
}

/** 6 characters from CODE_ALPHABET: what staff type when the camera won't scan. */
export function voucherTypedCode(secret: string, step: number): string {
  const digest = sha256Bytes(`${secret}:${step}`);
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  return code;
}

export function voucherQrPayload(voucherId: string, secret: string, step: number): string {
  return `${VOUCHER_QR_PREFIX}:${voucherId}:${voucherProof(secret, step)}`;
}

/** "K7Q4P2" -> "K7Q 4P2", for display only. */
export function formatTypedCode(code: string): string {
  const c = normaliseTypedCode(code) ?? code;
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

/** Uppercases, strips spaces and dashes, and maps the look-alikes staff tend
 * to type (O->0 is not in the alphabet, so O stays invalid). Returns null
 * unless exactly 6 alphabet characters remain. */
export function normaliseTypedCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== 6) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

// ---------------------------------------------------------------------------
// Shop stand
// ---------------------------------------------------------------------------

/** 16 hex chars: the kiosk's rotating stand key for this 30-second step. */
export function standRotatingKey(standSecret: string, step: number): string {
  return sha256Hex(`${standSecret}:stand:${step}`).slice(0, 16);
}

export function standUrl(standCode: string, key: string): string {
  return `${STAND_URL_BASE}${encodeURIComponent(standCode)}?k=${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------------------
// Parsing whatever a camera (or a member of staff) hands us
// ---------------------------------------------------------------------------

export type ScanResult =
  | { kind: 'voucher'; voucherId: string; proof: string }
  | { kind: 'stand'; standCode: string; key: string }
  | { kind: 'typed'; code: string };

const VOUCHER_RE = /^POWR-IS:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{16})$/i;
const STAND_RE = /^(?:https?:\/\/)?(?:www\.)?powr\.life\/s\/([A-Za-z0-9-]{2,24})\/?\?(?:.*&)?k=([0-9a-f]{16})(?:&.*)?$/i;

export function parseInStoreScan(raw: string): ScanResult | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const v = VOUCHER_RE.exec(text);
  if (v) return { kind: 'voucher', voucherId: v[1].toLowerCase(), proof: v[2].toLowerCase() };
  const s = STAND_RE.exec(text);
  if (s) return { kind: 'stand', standCode: s[1].toUpperCase(), key: s[2].toLowerCase() };
  const typed = normaliseTypedCode(text);
  if (typed) return { kind: 'typed', code: typed };
  return null;
}

// ---------------------------------------------------------------------------
// Till barcodes (chains). One entry per module; `guard` bars run taller on
// EAN-13, the way printed codes do. Rendered as plain rects by each surface.
// ---------------------------------------------------------------------------

export type BarModule = { on: boolean; guard: boolean };

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Accepts 12 digits (check digit added) or 13 digits (check digit verified).
 * Returns the full 13-digit string, or null when the code can't be an EAN-13. */
export function normaliseEan13(code: string): string | null {
  const digits = (code ?? '').replace(/\s/g, '');
  if (!/^\d{12,13}$/.test(digits)) return null;
  const check = ean13CheckDigit(digits.slice(0, 12));
  if (digits.length === 13 && Number(digits[12]) !== check) return null;
  return digits.slice(0, 12) + String(check);
}

export function ean13Modules(code: string): BarModule[] | null {
  const digits = normaliseEan13(code);
  if (!digits) return null;
  const mods: BarModule[] = [];
  const push = (pattern: string, guard: boolean) => {
    for (const b of pattern) mods.push({ on: b === '1', guard });
  };
  const parity = EAN_PARITY[Number(digits[0])];
  push('101', true);
  for (let i = 1; i <= 6; i++) {
    const d = Number(digits[i]);
    push(parity[i - 1] === 'L' ? EAN_L[d] : EAN_G[d], false);
  }
  push('01010', true);
  for (let i = 7; i <= 12; i++) push(EAN_R[Number(digits[i])], false);
  push('101', true);
  return mods;
}

/** "5 012345 678900", the human-readable line under an EAN-13. */
export function formatEan13(code: string): string | null {
  const d = normaliseEan13(code);
  return d ? `${d[0]} ${d.slice(1, 7)} ${d.slice(7)}` : null;
}

// Code 128 bar/space widths for values 0..106 (106 = stop, 7 elements).
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS = C128;

/** Code 128 set B: printable ASCII 32..126. Returns null for anything else. */
export function code128Modules(text: string): BarModule[] | null {
  const value = text ?? '';
  if (!value.length || value.length > 48) return null;
  const vals: number[] = [104]; // Start B
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 126) return null;
    vals.push(c - 32);
  }
  let checksum = vals[0];
  for (let i = 1; i < vals.length; i++) checksum += vals[i] * i;
  vals.push(checksum % 103, 106);

  const mods: BarModule[] = [];
  for (const v of vals) {
    const widths = C128[v];
    for (let i = 0; i < widths.length; i++) {
      const on = i % 2 === 0; // patterns start with a bar
      for (let w = 0; w < Number(widths[i]); w++) mods.push({ on, guard: false });
    }
  }
  return mods;
}

/** The bars for a chain's till code. EAN-13 falls back to Code 128 when the
 * code isn't a valid EAN, so a mislabelled pool still scans somewhere. QR is
 * drawn by each surface's own QR component, so it returns null here. */
export function tillBarcode(code: string, format: BarcodeFormat): { format: 'ean13' | 'code128'; modules: BarModule[]; text: string } | null {
  if (format === 'qr') return null;
  if (format === 'ean13') {
    const mods = ean13Modules(code);
    if (mods) return { format: 'ean13', modules: mods, text: formatEan13(code) ?? code };
  }
  const mods = code128Modules(code);
  return mods ? { format: 'code128', modules: mods, text: code } : null;
}
