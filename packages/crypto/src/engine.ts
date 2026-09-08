import type { Argon2idParams, OpaqueKey, SealedEnvelope, WrappedKey } from './types.js';

/**
 * Platform crypto seam. TypeScript sees only this interface and opaque byte buffers.
 * No algorithm implementation lives in this package. No Web Crypto.
 */
export interface CryptoEngine {
  randomBytes(length: number): Uint8Array;
  derivePassphraseKek(passphrase: Uint8Array, params: Argon2idParams): Promise<OpaqueKey>;
  wrapVmk(vmk: OpaqueKey, kek: OpaqueKey): Promise<WrappedKey>;
  unwrapVmk(wrapped: WrappedKey, kek: OpaqueKey): Promise<OpaqueKey>;
  sealObject(plaintext: Uint8Array, key: OpaqueKey, aad: Uint8Array): Promise<SealedEnvelope>;
  openObject(envelope: SealedEnvelope, key: OpaqueKey, aad: Uint8Array): Promise<Uint8Array>;
  hkdf(ikm: OpaqueKey, info: Uint8Array, length: number): Promise<OpaqueKey>;
  zeroize(key: OpaqueKey): void;
}
