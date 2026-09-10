import { describe, expect, it } from 'vitest';
import { NotImplementedStorageProvider } from './not-implemented.js';
import type { StorageProvider } from './provider.js';
import type { StorageCapabilities } from './types.js';

describe('@jot/storage', () => {
  it('StorageProvider types compile against the throwing adapter', () => {
    const provider: StorageProvider = new NotImplementedStorageProvider();
    expect(provider).toBeInstanceOf(NotImplementedStorageProvider);
  });

  it('capabilities signature is a closed limits object', () => {
    const sample: StorageCapabilities = {
      maxObjectBytes: 1,
      maxListLimit: 1,
      rangeReads: false,
      providerChecksums: false,
      changeCursor: true,
      completeRelistFallback: true,
    };
    expect(sample.changeCursor).toBe(true);
  });

  it('NotImplementedStorageProvider throws', async () => {
    const provider = new NotImplementedStorageProvider();
    await expect(provider.identifyNamespace()).rejects.toThrow('identifyNamespace');
  });
});
