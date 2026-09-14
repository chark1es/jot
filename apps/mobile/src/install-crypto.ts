import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

type Subtle = {
  digest?: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
};

type RuntimeCrypto = {
  getRandomValues?: typeof getRandomValues;
  subtle?: Subtle;
};

const ALGORITHMS: Readonly<Record<string, CryptoDigestAlgorithm>> = {
  'SHA-1': CryptoDigestAlgorithm.SHA1,
  'SHA-256': CryptoDigestAlgorithm.SHA256,
  'SHA-384': CryptoDigestAlgorithm.SHA384,
  'SHA-512': CryptoDigestAlgorithm.SHA512,
};

/** Hermes has no Web Crypto. Attachment import hashes bytes with `crypto.subtle.digest`. */
function subtleDigest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> {
  const mapped = ALGORITHMS[algorithm.toUpperCase()];
  if (mapped === undefined) {
    return Promise.reject(new Error(`Unsupported digest algorithm ${algorithm}`));
  }
  return digest(mapped, data as Uint8Array<ArrayBuffer>);
}

const runtime = globalThis as unknown as { crypto?: RuntimeCrypto | null };

if (runtime.crypto == null) {
  Object.defineProperty(runtime, 'crypto', {
    configurable: true,
    value: { getRandomValues, subtle: { digest: subtleDigest } },
    writable: true,
  });
} else {
  if (typeof runtime.crypto.getRandomValues !== 'function') {
    Object.defineProperty(runtime.crypto, 'getRandomValues', {
      configurable: true,
      value: getRandomValues,
      writable: true,
    });
  }
  if (typeof runtime.crypto.subtle?.digest !== 'function') {
    Object.defineProperty(runtime.crypto, 'subtle', {
      configurable: true,
      value: { ...runtime.crypto.subtle, digest: subtleDigest },
      writable: true,
    });
  }
}
