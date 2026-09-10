import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'stub-expo-modules-core',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'expo-modules-core') {
          return '\0expo-modules-core';
        }
        return undefined;
      },
      load(id) {
        if (id === '\0expo-modules-core') {
          return 'export function requireNativeViewManager() { return function Stub() { return null; }; }';
        }
        return undefined;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
