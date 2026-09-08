export type SeededPrng = {
  nextUint32(): number;
  nextFloat(): number;
  nextBytes(length: number): Uint8Array;
};

/**
 * Mulberry32. Deterministic. Not a CSPRNG.
 */
export function createSeededPrng(seed: number): SeededPrng {
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    nextUint32,
    nextFloat: () => nextUint32() / 0x1_0000_0000,
    nextBytes(length: number): Uint8Array {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        const value = nextUint32();
        out[i] = value & 0xff;
      }
      return out;
    },
  };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, lowercase, no padding. 128-bit IDs are 26 characters. */
export function encodeBase32NoPad(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32[(value << (5 - bits)) & 31] ?? '';
  }
  return out;
}

export function nextBase32Id(prng: SeededPrng): string {
  return encodeBase32NoPad(prng.nextBytes(16)).slice(0, 26);
}
