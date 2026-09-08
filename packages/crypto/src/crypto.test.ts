import { describe, expect, it } from 'vitest';
import { NotImplementedCryptoEngine } from './not-implemented.js';
import type { CryptoEngine } from './engine.js';
import { AEAD_SUITE_ID, ARGON2ID_DEFAULT, ARGON2ID_LOW_MEMORY_DISCLOSED } from './types.js';

describe('@jolt/crypto', () => {
  it('exposes Argon2id v1.3 default 64 MiB / 3 passes / 4 lanes', () => {
    expect(ARGON2ID_DEFAULT).toEqual({
      version: '1.3',
      memoryKiB: 65536,
      passes: 3,
      lanes: 4,
    });
  });

  it('documents the 32 MiB / 4-pass fallback as disclosed, never silent', () => {
    expect(ARGON2ID_LOW_MEMORY_DISCLOSED).toEqual({
      version: '1.3',
      memoryKiB: 32768,
      passes: 4,
      lanes: 4,
    });
  });

  it('names the AEAD suite', () => {
    expect(AEAD_SUITE_ID).toBe('xchacha20poly1305-v1');
  });

  it('CryptoEngine types compile against the throwing adapter', () => {
    const engine: CryptoEngine = new NotImplementedCryptoEngine();
    expect(() => engine.randomBytes(32)).toThrow('randomBytes');
  });
});
