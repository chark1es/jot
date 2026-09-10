import { describe, expect, it } from 'vitest';
import { FOLDER_CYCLE_REPAIR_RULE, newestParentEdgeToRemove } from './folder-cycle.js';
import { evaluateSchemaGate } from './schema-gate.js';
import type { FolderId } from '@jot/schema';
import type { DeviceId } from '@jot/schema';
import { nextLogicalTime } from './clock.js';
import { UnsupportedCrdtDocument } from './crdt.js';

describe('@jot/core', () => {
  it('Lamport nextLogical increments past max(local, observed)', () => {
    const device = 'aaaaaaaaaaaaaaaaaaaaaaaaaa' as DeviceId;
    const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbb' as DeviceId;
    const next = nextLogicalTime(
      { counter: 3, deviceId: device },
      { counter: 10, deviceId: other },
      device,
    );
    expect(next.counter).toBe(11);
    expect(next.deviceId).toBe(device);
  });

  it('Folder cycle repair removes the newest parent edge and never deletes', () => {
    const a = 'aaaaaaaaaaaaaaaaaaaaaaaaaa' as FolderId;
    const b = 'bbbbbbbbbbbbbbbbbbbbbbbbbb' as FolderId;
    const c = 'cccccccccccccccccccccccccc' as FolderId;
    const device = 'dddddddddddddddddddddddddd' as DeviceId;
    const repair = newestParentEdgeToRemove([
      { childId: a, parentId: b, logicalTime: { counter: 1, deviceId: device } },
      { childId: b, parentId: c, logicalTime: { counter: 2, deviceId: device } },
      { childId: c, parentId: a, logicalTime: { counter: 9, deviceId: device } },
    ]);
    expect(repair?.rule).toBe(FOLDER_CYCLE_REPAIR_RULE);
    expect(repair?.removedEdge.childId).toBe(c);
  });

  it('schema version gate refuses unsupported readers', () => {
    expect(
      evaluateSchemaGate({ localSchemaVersion: 1, minReaderVersion: 2, minWriterVersion: 2 }),
    ).toEqual({ status: 'readerTooOld', minReaderVersion: 2 });
  });

  it('UnsupportedCrdtDocument throws', () => {
    const doc = new UnsupportedCrdtDocument();
    expect(() => {
      doc.applyUpdate(new Uint8Array());
    }).toThrow('not implemented');
  });
});
