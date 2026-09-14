import { describe, expect, it } from 'vitest';
import { createId, deriveId, parseDocument } from '@jot/schema';
import type { NoteId, TransactionId } from '@jot/schema';
import { createMemoryLocalStore } from './bun-sqlite.js';
import type { StoreClock } from './types.js';

class StepClock implements StoreClock {
  private wallMs = 1_000;

  wallNow(): { readonly unixMs: number } {
    this.wallMs += 10;
    return { unixMs: this.wallMs };
  }
}

describe('listAppliedTransactionIds', () => {
  it('returns the newest committed transactions for one note only', async () => {
    const store = createMemoryLocalStore({ clock: new StepClock() });
    await store.open();
    const noteId = await store.createNote();
    const other = await store.createNote();
    const commit = async (target: NoteId): Promise<TransactionId> => {
      const loaded = await store.getNoteDocument(target);
      if (loaded === null) {
        throw new Error('note is missing');
      }
      const transactionId = createId<TransactionId>();
      const paragraphId = deriveId(loaded.document.id, 'paragraph', 0);
      await store.commitEdit({
        transactionId,
        noteId: target,
        operations: [],
        crdtUpdate: new Uint8Array([1]),
        document: parseDocument({
          type: 'doc',
          id: loaded.document.id,
          content: [{ type: 'paragraph', id: paragraphId, content: [] }],
        }),
        projection: { noteId: target, title: '', folderId: null, pinned: false, archived: false, trashed: false, plainBody: '' },
        undo: { transactionId, noteId: target, inverse: new Uint8Array([1]) },
        outbox: { transactionId, noteId: target, payload: new Uint8Array([1]) },
      });
      return transactionId;
    };
    const first = await commit(noteId);
    await commit(other);
    const second = await commit(noteId);
    const third = await commit(noteId);
    expect(await store.listAppliedTransactionIds(noteId, 2)).toEqual([third, second]);
    expect(await store.listAppliedTransactionIds(noteId, 10)).toEqual([third, second, first]);
    await store.close();
  });
});
