import { describe, expect, it } from 'vitest';
import { createTauriLocalStore, NotImplementedError } from './index.js';

describe('@jot/local-store-tauri', () => {
  it('imports and throws', () => {
    expect(() => createTauriLocalStore()).toThrow(NotImplementedError);
  });
});
