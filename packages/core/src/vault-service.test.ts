import { describe, expect, it } from 'vitest';
import { createMemoryLocalStore } from '@jot/local-store/bun';
import { createId } from '@jot/schema';
import type { DeviceId, LogicalTime, TransactionId } from '@jot/schema';
import { nextLogicalTime } from './clock.js';
import type { Clock, WallTime } from './clock.js';
import { VaultService } from './vault-service.js';

class FakeClock implements Clock {
  constructor(private readonly startUnixMs: number) {}

  wallNow(): WallTime {
    return { unixMs: this.startUnixMs };
  }

  nextLogical(local: LogicalTime, observed: LogicalTime, deviceId: DeviceId): LogicalTime {
    return nextLogicalTime(local, observed, deviceId);
  }
}

describe('VaultService', () => {
  it('commits operations and restores a Version as a new edit', async () => {
    const clock = new FakeClock(1_000);
    const store = createMemoryLocalStore({ clock });
    const vault = new VaultService(store, clock);
    await vault.open();
    const noteId = await vault.createNote('Title');
    const loaded = await store.getNoteDocument(noteId);
    expect(loaded).not.toBeNull();
    if (loaded === null) {
      return;
    }
    await vault.commitOperations({
      noteId,
      transactionId: createId<TransactionId>(),
      operations: [
        {
          type: 'insertText',
          position: {
            nodeId: loaded.document.id,
            offsetUtf16: 0,
            affinity: 'after',
            revision: 0,
          },
          text: 'BodyOne',
          storedMarks: [],
        },
      ],
      undoInverse: new Uint8Array([1]),
    });
    const version = await store.saveVersion(noteId, { label: 'v1' });
    const afterFirst = await store.getNoteDocument(noteId);
    const paraId = afterFirst?.document.content[0]?.id;
    expect(paraId).toBeDefined();
    if (paraId === undefined) {
      return;
    }
    await vault.commitOperations({
      noteId,
      transactionId: createId<TransactionId>(),
      operations: [
        {
          type: 'insertText',
          position: {
            nodeId: paraId,
            offsetUtf16: 7,
            affinity: 'after',
            revision: 0,
          },
          text: 'Two',
          storedMarks: [],
        },
      ],
      undoInverse: new Uint8Array([2]),
    });
    const afterSecond = await store.getNoteProjection(noteId);
    expect(afterSecond?.plainBody.includes('Two')).toBe(true);
    const restoreTx = createId<TransactionId>();
    await vault.restoreVersionAsEdit(noteId, version.id, restoreTx);
    const restored = await store.getNoteProjection(noteId);
    expect(restored?.plainBody.includes('BodyOne')).toBe(true);
    expect(restored?.plainBody.includes('Two')).toBe(false);
    const updates = await store.getCrdtUpdates(noteId);
    expect(updates.length).toBeGreaterThan(1);
    await vault.close();
  });
});
