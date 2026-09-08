import { describe, expect, it } from 'vitest';
import { exportNotes, NotImplementedError } from './index.js';

describe('@jolt/import-export', () => {
  it('imports and throws', () => {
    expect(() => exportNotes({ noteIds: [] }, [])).toThrow(NotImplementedError);
  });
});
