export const CROCKFORD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_REGEX = /^POWR-[A-Z0-9]{4}-[A-Z0-9]{6}$/;

export function generateToken(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CROCKFORD_ALPHABET[Math.floor(Math.random() * CROCKFORD_ALPHABET.length)];
  }
  return out;
}

export function generateCode(partnerCode: string): string {
  return `POWR-${partnerCode.toUpperCase()}-${generateToken(6)}`;
}

export function isValidCodeFormat(code: string): boolean {
  return CODE_REGEX.test(code);
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}
