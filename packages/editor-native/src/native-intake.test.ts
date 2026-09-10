import { describe, expect, it } from 'vitest';
import { createId, deriveId, parseId } from '@jot/schema';
import type { TransactionId } from '@jot/schema';
import {
  createNativeIntakeLedger,
  listUnappliedIntake,
  markIntakeApplied,
  parseJournalPayload,
  parseSchemaOperations,
} from './native-intake.js';

const docId = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');
const paraId = deriveId(docId, 'paragraph', 0);

function insertPayload(transactionId: TransactionId) {
  return {
    transactionId,
    baseRevision: 0,
    operations: [
      {
        type: 'insertText',
        position: {
          nodeId: paraId,
          offsetUtf16: 0,
          affinity: 'after',
          revision: 0,
        },
        text: 'Hi',
        storedMarks: [],
      },
    ],
    selection: {
      nodeId: paraId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 1,
    },
  };
}

describe('native-intake', () => {
  it('missing native module lists empty and markApplied is a no-op', async () => {
    const ledger = createNativeIntakeLedger();
    expect(await ledger.listUnapplied()).toEqual([]);
    await expect(ledger.markApplied(createId<TransactionId>())).resolves.toBeUndefined();
    expect(await listUnappliedIntake()).toEqual([]);
    await expect(markIntakeApplied(createId<TransactionId>())).resolves.toBeUndefined();
  });

  it('parses journal payload JSON to SchemaOperation[]', () => {
    const transactionId = createId<TransactionId>();
    const parsed = parseJournalPayload(JSON.stringify(insertPayload(transactionId)));
    expect(parsed.transactionId).toBe(transactionId);
    expect(parsed.operations).toEqual([
      {
        type: 'insertText',
        position: {
          nodeId: paraId,
          offsetUtf16: 0,
          affinity: 'after',
          revision: 0,
        },
        text: 'Hi',
        storedMarks: [],
      },
    ]);
  });

  it('lists unapplied rows from a handle and marks applied', async () => {
    const transactionId = createId<TransactionId>();
    const marked: string[] = [];
    const ledger = createNativeIntakeLedger({
      listUnappliedIntake: () =>
        Promise.resolve([
          { transactionId, payload: JSON.stringify(insertPayload(transactionId)) },
        ]),
      markIntakeApplied: (id) => {
        marked.push(id);
        return Promise.resolve();
      },
    });

    const rows = await ledger.listUnapplied();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transactionId).toBe(transactionId);
    expect(rows[0]?.operations[0]?.type).toBe('insertText');

    await ledger.markApplied(transactionId);
    expect(marked).toEqual([transactionId]);
  });

  it('parseSchemaOperations reads a committed insertText', () => {
    const ops = parseSchemaOperations(insertPayload(createId<TransactionId>()).operations);
    expect(ops[0]?.type).toBe('insertText');
    if (ops[0]?.type === 'insertText') {
      expect(ops[0].text).toBe('Hi');
    }
  });
});
