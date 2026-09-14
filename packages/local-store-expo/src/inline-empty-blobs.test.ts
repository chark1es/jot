import { describe, expect, it } from 'vitest';
import { inlineEmptyBlobs } from './index.js';

describe('inlineEmptyBlobs', () => {
  it('writes empty blobs into the statement and keeps the other parameters in order', () => {
    const bytes = new Uint8Array([1]);
    const bound = inlineEmptyBlobs(
      'INSERT INTO t(a, b, c, d) VALUES (?, ?, ?, ?)',
      ['note', new Uint8Array(0), bytes, 5],
    );
    expect(bound.sql).toBe('INSERT INTO t(a, b, c, d) VALUES (?, zeroblob(0), ?, ?)');
    expect(bound.params).toEqual(['note', bytes, 5]);
  });

  it('ignores question marks inside string literals', () => {
    const bound = inlineEmptyBlobs("SELECT '?' AS literal, ? AS blob, ? AS id", [new Uint8Array(0), 'x']);
    expect(bound.sql).toBe("SELECT '?' AS literal, zeroblob(0) AS blob, ? AS id");
    expect(bound.params).toEqual(['x']);
  });

  it('leaves statements without empty blobs untouched', () => {
    const params = ['a', new Uint8Array([2])];
    expect(inlineEmptyBlobs('SELECT ?, ?', params)).toEqual({ sql: 'SELECT ?, ?', params });
  });
});
