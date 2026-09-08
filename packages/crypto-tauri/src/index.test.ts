import { describe, expect, it } from 'vitest';
import { createTauriCryptoEngine, NotImplementedError } from './index.js';

describe('@jolt/crypto-tauri', () => {
  it('imports and throws', () => {
    expect(() => createTauriCryptoEngine()).toThrow(NotImplementedError);
  });
});
