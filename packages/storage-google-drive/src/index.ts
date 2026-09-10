import type { ChangeWakeup } from '@jot/change-wakeup';
import type { StorageProvider } from '@jot/storage';

/**
 * README: StorageProvider adapter for the user's Drive folder.
 * Receives a token source and ChangeWakeup. Phase 0 stub.
 * No production implementation. Provider file IDs stay inside this adapter.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export type GoogleDriveStorageConfig = {
  readonly wakeup: ChangeWakeup | null;
};

export function createGoogleDriveStorage(config: GoogleDriveStorageConfig): StorageProvider {
  throw new NotImplementedError(
    `NotImplemented google-drive adapter (wakeup=${config.wakeup === null ? 'none' : 'present'})`,
  );
}
