import type { StorageProvider } from './provider.js';
import type { ChangeBatch, StorageCapabilities } from './types.js';

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

/**
 * Throws on every method. The adversarial in-memory adapter ships in Phase 2.
 */
export class NotImplementedStorageProvider implements StorageProvider {
  identifyNamespace(): Promise<never> {
    return Promise.reject(
      new NotImplementedError('StorageProvider.identifyNamespace is not implemented'),
    );
  }

  createNamespace(): Promise<never> {
    return Promise.reject(
      new NotImplementedError('StorageProvider.createNamespace is not implemented'),
    );
  }

  list(): Promise<never> {
    return Promise.reject(new NotImplementedError('StorageProvider.list is not implemented'));
  }

  stat(): Promise<never> {
    return Promise.reject(new NotImplementedError('StorageProvider.stat is not implemented'));
  }

  read(): Promise<never> {
    return Promise.reject(new NotImplementedError('StorageProvider.read is not implemented'));
  }

  writeImmutable(): Promise<never> {
    return Promise.reject(
      new NotImplementedError('StorageProvider.writeImmutable is not implemented'),
    );
  }

  delete(): Promise<never> {
    return Promise.reject(new NotImplementedError('StorageProvider.delete is not implemented'));
  }

  getChangeCursor(): Promise<never> {
    return Promise.reject(
      new NotImplementedError('StorageProvider.getChangeCursor is not implemented'),
    );
  }

  watchChanges(): AsyncIterable<ChangeBatch> {
    throw new NotImplementedError('StorageProvider.watchChanges is not implemented');
  }

  capabilities(): StorageCapabilities {
    throw new NotImplementedError('StorageProvider.capabilities is not implemented');
  }
}
