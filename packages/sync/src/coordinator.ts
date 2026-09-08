import type { CrdtDocument } from '@jolt/core';
import type { CryptoEngine } from '@jolt/crypto';
import type { LocalStore } from '@jolt/local-store';
import type { StorageProvider } from '@jolt/storage';
import type { NoteId } from '@jolt/schema';

export type SyncCoordinatorDeps = {
  readonly storage: StorageProvider;
  readonly crypto: CryptoEngine;
  readonly localStore: LocalStore;
  readonly openDocument: (noteId: NoteId) => CrdtDocument;
};

export interface SyncCoordinator {
  publishLocal(): Promise<void>;
  ingestRemote(): Promise<void>;
  compact(noteId: NoteId): Promise<void>;
}

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export function createSyncCoordinator(deps: SyncCoordinatorDeps): SyncCoordinator {
  const depCount = [deps.storage, deps.crypto, deps.localStore, deps.openDocument].length;
  throw new NotImplementedError(`SyncCoordinator is not implemented (${String(depCount)} deps)`);
}
