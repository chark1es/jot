import { describe, expect, it } from 'vitest';
import { createExpoLocalStore, NotImplementedError } from './index.js';

describe('@jolt/local-store-expo', () => {
  it('imports and throws', () => {
    expect(() => createExpoLocalStore()).toThrow(NotImplementedError);
  });
});
