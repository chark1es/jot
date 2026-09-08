import type { LocalStore } from '@jolt/local-store';

/**
 * README: expo-sqlite adapter for LocalStore.
 * Phase 0 stub. No production implementation.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor() {
    super('NotImplemented');
  }
}

export function createExpoLocalStore(): LocalStore {
  throw new NotImplementedError();
}
