import type { CryptoEngine } from './engine.js';
import type { OpaqueKey, SealedEnvelope, WrappedKey } from './types.js';

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export class NotImplementedCryptoEngine implements CryptoEngine {
  randomBytes(): Uint8Array {
    throw new NotImplementedError('CryptoEngine.randomBytes is not implemented');
  }

  derivePassphraseKek(): Promise<OpaqueKey> {
    return Promise.reject(
      new NotImplementedError('CryptoEngine.derivePassphraseKek is not implemented'),
    );
  }

  wrapVmk(): Promise<WrappedKey> {
    return Promise.reject(new NotImplementedError('CryptoEngine.wrapVmk is not implemented'));
  }

  unwrapVmk(): Promise<OpaqueKey> {
    return Promise.reject(new NotImplementedError('CryptoEngine.unwrapVmk is not implemented'));
  }

  sealObject(): Promise<SealedEnvelope> {
    return Promise.reject(new NotImplementedError('CryptoEngine.sealObject is not implemented'));
  }

  openObject(): Promise<Uint8Array> {
    return Promise.reject(new NotImplementedError('CryptoEngine.openObject is not implemented'));
  }

  hkdf(): Promise<OpaqueKey> {
    return Promise.reject(new NotImplementedError('CryptoEngine.hkdf is not implemented'));
  }

  zeroize(): void {
    throw new NotImplementedError('CryptoEngine.zeroize is not implemented');
  }
}
