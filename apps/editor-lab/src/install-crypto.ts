import { getRandomValues } from 'expo-crypto';

type RuntimeCrypto = {
  getRandomValues?: typeof getRandomValues;
};

const runtime = globalThis as unknown as { crypto?: RuntimeCrypto | null };

if (runtime.crypto == null) {
  Object.defineProperty(runtime, 'crypto', {
    configurable: true,
    value: { getRandomValues },
    writable: true,
  });
} else if (typeof runtime.crypto.getRandomValues !== 'function') {
  Object.defineProperty(runtime.crypto, 'getRandomValues', {
    configurable: true,
    value: getRandomValues,
    writable: true,
  });
}
