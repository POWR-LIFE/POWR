// In-store redemption helpers (shared/inStore.ts).
//
// The member's phone, the staff scan page and Postgres each derive the same
// rotating voucher code on their own. If any one of them drifts, staff see
// "not valid" on a genuine voucher at the till, so the vectors below were
// computed by pgcrypto in the production database (extensions.digest) and are
// pinned here.

import {
  CODE128_PATTERNS,
  CODE_ALPHABET,
  code128Modules,
  ean13Modules,
  formatEan13,
  formatTypedCode,
  normaliseEan13,
  normaliseTypedCode,
  parseInStoreScan,
  sha256Hex,
  standRotatingKey,
  standUrl,
  tillBarcode,
  voucherProof,
  voucherQrPayload,
  voucherTypedCode,
  codeStep,
} from '@/shared/inStore';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('sha256', () => {
  it('matches the FIPS test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // Two blocks: the padding has to spill into a second 64-byte chunk.
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with pgcrypto on the exact strings the voucher uses', () => {
    expect(sha256Hex(`${SECRET}:177600000`)).toBe(
      '9e818a842b86be41f559d21dd145c25acb980e0650e048d94edc357df5f783c8',
    );
  });
});

describe('rotating voucher code', () => {
  it('derives the QR proof and the typed code the database expects', () => {
    expect(voucherProof(SECRET, 177600000)).toBe('9e818a842b86be41');
    expect(voucherTypedCode(SECRET, 177600000)).toBe('DFRJPM');
  });

  it('changes every step and stays inside the alphabet', () => {
    const a = voucherTypedCode(SECRET, 1);
    const b = voucherTypedCode(SECRET, 2);
    expect(a).not.toBe(b);
    for (const ch of a + b) expect(CODE_ALPHABET).toContain(ch);
    expect(CODE_ALPHABET).toHaveLength(31);
  });

  it('steps every 10 seconds', () => {
    expect(codeStep(1_776_000_000_000)).toBe(177600000);
    expect(codeStep(1_776_000_009_999)).toBe(177600000);
    expect(codeStep(1_776_000_010_000)).toBe(177600001);
  });

  it('builds a QR payload the scanner reads back', () => {
    const id = '3f2b8c1e-9a4d-4c2b-8e7f-0a1b2c3d4e5f';
    const payload = voucherQrPayload(id, SECRET, 177600000);
    expect(payload).toBe(`POWR-IS:${id}:9e818a842b86be41`);
    expect(parseInStoreScan(payload)).toEqual({ kind: 'voucher', voucherId: id, proof: '9e818a842b86be41' });
  });
});

describe('shop stand', () => {
  it('rotates the kiosk key the way the database checks it', () => {
    expect(standRotatingKey(SECRET, 59200000)).toBe('296c27dafe3f7870');
  });

  it('round-trips the stand URL through the scanner', () => {
    const url = standUrl('SHD-01', 'a1b2c3d4e5f60718');
    expect(url).toBe('https://powr.life/s/SHD-01?k=a1b2c3d4e5f60718');
    expect(parseInStoreScan(url)).toEqual({ kind: 'stand', standCode: 'SHD-01', key: 'a1b2c3d4e5f60718' });
    expect(parseInStoreScan('powr.life/s/shd-01?utm=x&k=A1B2C3D4E5F60718')).toEqual({
      kind: 'stand',
      standCode: 'SHD-01',
      key: 'a1b2c3d4e5f60718',
    });
  });

  it('ignores other powr.life links and look-alike hosts', () => {
    expect(parseInStoreScan('https://powr.life/app?to=add-friend&ref=ABC123')).toBeNull();
    expect(parseInStoreScan('https://evilpowr.life/s/SHD-01?k=a1b2c3d4e5f60718')).toBeNull();
  });
});

describe('typed fallback code', () => {
  it('accepts what staff actually type', () => {
    expect(normaliseTypedCode('dfr jpm')).toBe('DFRJPM');
    expect(normaliseTypedCode('DFR-JPM')).toBe('DFRJPM');
    expect(parseInStoreScan(' dfr jpm ')).toEqual({ kind: 'typed', code: 'DFRJPM' });
  });

  it('rejects characters the alphabet leaves out on purpose', () => {
    expect(normaliseTypedCode('DFR0PM')).toBeNull();
    expect(normaliseTypedCode('DFR1PM')).toBeNull();
    expect(normaliseTypedCode('DFROPM')).toBeNull();
    expect(normaliseTypedCode('DFRJP')).toBeNull();
  });

  it('formats for display', () => {
    expect(formatTypedCode('DFRJPM')).toBe('DFR JPM');
  });
});

describe('EAN-13', () => {
  it('adds or verifies the check digit', () => {
    expect(normaliseEan13('501234567890')).toBe('5012345678900');
    expect(normaliseEan13('4006381333931')).toBe('4006381333931');
    expect(normaliseEan13('4006381333932')).toBeNull();
    expect(normaliseEan13('POWR-123')).toBeNull();
  });

  it('lays out 95 modules with the three guard patterns', () => {
    const mods = ean13Modules('4006381333931')!;
    expect(mods).toHaveLength(95);
    const bits = mods.map((m) => (m.on ? '1' : '0')).join('');
    expect(bits.slice(0, 3)).toBe('101');
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.slice(92)).toBe('101');
    expect(mods.filter((m) => m.guard)).toHaveLength(11);
    // First digit 4 = parity LGLLGG; digit "0" in the first slot (L) is 0001101.
    expect(bits.slice(3, 10)).toBe('0001101');
  });

  it('prints the human-readable line', () => {
    expect(formatEan13('501234567890')).toBe('5 012345 678900');
  });
});

describe('Code 128', () => {
  it('has a complete, unambiguous width table', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const modules = [...p].reduce((s, w) => s + Number(w), 0);
      expect(modules).toBe(i === 106 ? 13 : 11);
    });
  });

  // Decode our own output: widths -> symbol values -> text + checksum.
  function decode(text: string) {
    const mods = code128Modules(text)!;
    const runs: number[] = [];
    let prev: boolean | null = null;
    for (const m of mods) {
      if (m.on === prev) runs[runs.length - 1]++;
      else runs.push(1);
      prev = m.on;
    }
    const values: number[] = [];
    let i = 0;
    while (i < runs.length) {
      const six = runs.slice(i, i + 6).join('');
      const seven = runs.slice(i, i + 7).join('');
      if (seven === CODE128_PATTERNS[106]) {
        values.push(106);
        i += 7;
      } else {
        values.push(CODE128_PATTERNS.indexOf(six));
        i += 6;
      }
    }
    return values;
  }

  it('encodes set B with a valid checksum', () => {
    const values = decode('POWR-8K2F');
    expect(values[0]).toBe(104);
    expect(values[values.length - 1]).toBe(106);
    const data = values.slice(1, -2);
    expect(String.fromCharCode(...data.map((v) => v + 32))).toBe('POWR-8K2F');
    const check = values[values.length - 2];
    const sum = data.reduce((s, v, k) => s + v * (k + 1), 104);
    expect(check).toBe(sum % 103);
  });

  it('refuses characters outside printable ASCII', () => {
    expect(code128Modules('café')).toBeNull();
    expect(code128Modules('')).toBeNull();
  });
});

describe('tillBarcode', () => {
  it('uses EAN-13 when the code is one, and falls back to Code 128 when not', () => {
    expect(tillBarcode('501234567890', 'ean13')?.format).toBe('ean13');
    expect(tillBarcode('POWR-8K2F', 'ean13')?.format).toBe('code128');
    expect(tillBarcode('POWR-8K2F', 'code128')?.text).toBe('POWR-8K2F');
    expect(tillBarcode('POWR-8K2F', 'qr')).toBeNull();
  });
});
