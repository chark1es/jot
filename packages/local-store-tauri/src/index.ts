import type { LocalStore } from '@jot/local-store';

/**
 * README: typed TypeScript client for Tauri SQLite commands.
 * Phase 0 stub. No production implementation.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor() {
    super('NotImplemented');
  }
}

export function createTauriLocalStore(): LocalStore {
  throw new NotImplementedError();
}
