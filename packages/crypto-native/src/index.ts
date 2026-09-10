import type { CryptoEngine } from '@jot/crypto';

/**
 * README: Expo adapter to the Rust crypto core and native key stores.
 * Phase 0 stub. No production implementation.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor() {
    super('NotImplemented');
  }
}

export function createNativeCryptoEngine(): CryptoEngine {
  throw new NotImplementedError();
}
