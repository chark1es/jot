import { describe, expect, it } from 'vitest';
import { LOCAL_STORE_TABLE_GROUPS } from './types.js';
import { NotImplementedLocalStore } from './not-implemented.js';
import type { LocalStore } from './store.js';

describe('@jolt/local-store', () => {
  it('exports 3.4 table group names', () => {
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('notes');
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('editor_intake');
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('notes_fts');
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('outbox');
    expect(LOCAL_STORE_TABLE_GROUPS).toHaveLength(20);
  });

  it('LocalStore types compile', () => {
    const store: LocalStore = new NotImplementedLocalStore();
    expect(store).toBeInstanceOf(NotImplementedLocalStore);
  });
});
