import { describe, expect, it } from 'vitest';
import { createNativeCryptoEngine, NotImplementedError } from './index.js';

describe('@jolt/crypto-native', () => {
  it('imports and throws', () => {
    expect(() => createNativeCryptoEngine()).toThrow(NotImplementedError);
  });
});
