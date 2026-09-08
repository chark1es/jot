import type { Brand } from './brand.js';

/** Opaque key bytes. TypeScript never interprets the algorithm. */
export type OpaqueKey = Brand<Uint8Array, 'OpaqueKey'>;

export type WrappedKey = Brand<Uint8Array, 'WrappedKey'>;

/**
 * Argon2id v1.3 parameters.
 *
 * Default profile: 64 MiB, 3 passes, 4 lanes (RFC 9106 memory-constrained).
 *
 * The 32 MiB / 4-pass profile is a disclosed fallback for low-memory devices.
 * It is never applied silently. The weakest stored wrapper sets the offline
 * attack cost, so Jolt must not add a low-memory wrapper merely for convenience.
 */
export type Argon2idParams = {
  readonly version: '1.3';
  readonly memoryKiB: number;
  readonly passes: number;
  readonly lanes: number;
};

export const ARGON2ID_DEFAULT: Argon2idParams = {
  version: '1.3',
  memoryKiB: 64 * 1024,
  passes: 3,
  lanes: 4,
};

/**
 * Disclosed low-memory fallback. Never silent.
 * 32 MiB, 4 passes, 4 lanes.
 */
export const ARGON2ID_LOW_MEMORY_DISCLOSED: Argon2idParams = {
  version: '1.3',
  memoryKiB: 32 * 1024,
  passes: 4,
  lanes: 4,
};

export const AEAD_SUITE_ID = 'xchacha20poly1305-v1' as const;

export type AeadSuiteId = typeof AEAD_SUITE_ID;

export type EncryptionDescriptor =
  | { readonly mode: 'none' }
  | {
      readonly mode: 'namedSuite';
      readonly suiteId: AeadSuiteId;
      readonly nonce: Uint8Array;
    };

export type SealedEnvelope = {
  readonly encryption: EncryptionDescriptor;
  readonly ciphertext: Uint8Array;
};
