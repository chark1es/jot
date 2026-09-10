import type { CryptoEngine } from '@jot/crypto';

/**
 * README: Tauri adapter to the Rust crypto core and desktop key stores.
 * Phase 0 stub. No production implementation.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor() {
    super('NotImplemented');
  }
}

export function createTauriCryptoEngine(): CryptoEngine {
  throw new NotImplementedError();
}
