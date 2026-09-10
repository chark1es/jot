import { describe, expect, it } from 'vitest';
import { canonicalizeDocument, createId, deriveId, parseDocument, parseId } from '@jot/schema';
import type { NodeId, TransactionId } from '@jot/schema';
import { YjsCrdtDocument } from './yjs-document.js';
import { EditMaterializer, MemoryIntakeLedger } from './materializer.js';

const docId = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');

function seedParagraph(text = 'Hello') {
  const paraId = deriveId(docId, 'paragraph', 0);
  const textId = deriveId(paraId, 'text', 0);
  return {
    document: parseDocument({
      type: 'doc',
      id: docId,
      content: [
        {
          type: 'paragraph',
          id: paraId,
          content: [{ type: 'text', id: textId, text, marks: [] }],
        },
      ],
    }),
    paraId,
  };
}

function insertAt(nodeId: NodeId, offsetUtf16: number, text: string) {
  return {
    type: 'insertText' as const,
    position: {
      nodeId,
      offsetUtf16,
      affinity: 'after' as const,
      revision: 0,
    },
    text,
    storedMarks: [],
  };
}

describe('EditMaterializer', () => {
  it('insertText committed matches canonical Document; replica encode/apply matches', async () => {
    const { document, paraId } = seedParagraph();
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const ledger = new MemoryIntakeLedger();
    const materializer = new EditMaterializer(crdt, ledger);
    const transactionId = createId<TransactionId>();

    await materializer.materialize(
      {
        transactionId,
        operations: [insertAt(paraId, 5, '!')],
      },
      () => Promise.resolve(),
    );

    const canonical = crdt.getCanonicalDocument();
    expect(canonical.content[0]?.content[0]?.text).toBe('Hello!');
    expect(materializer.appliedCount()).toBe(1);
    expect(materializer.lastTransactionId()).toBe(transactionId);

    const replica = new YjsCrdtDocument();
    replica.applyUpdate(materializer.lastUpdate());
    expect(canonicalizeDocument(replica.getCanonicalDocument())).toEqual(
      canonicalizeDocument(canonical),
    );
  });

  it('duplicate transactionId does not double-insert', async () => {
    const { document, paraId } = seedParagraph();
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const ledger = new MemoryIntakeLedger();
    const materializer = new EditMaterializer(crdt, ledger);
    const transactionId = createId<TransactionId>();
    const record = {
      transactionId,
      operations: [insertAt(paraId, 5, '!')],
    };

    await materializer.materialize(record, () => Promise.resolve());
    const once = canonicalizeDocument(crdt.getCanonicalDocument());
    await materializer.materialize(record, () => Promise.resolve());

    expect(canonicalizeDocument(crdt.getCanonicalDocument())).toEqual(once);
    expect(crdt.getCanonicalDocument().content[0]?.content[0]?.text).toBe('Hello!');
    expect(materializer.appliedCount()).toBe(1);
  });

  it('recover() durably commits each replay before marking it applied', async () => {
    const { document, paraId } = seedParagraph();
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const ledger = new MemoryIntakeLedger();
    const first = createId<TransactionId>();
    const second = createId<TransactionId>();
    await ledger.append({
      transactionId: first,
      operations: [insertAt(paraId, 5, '!')],
    });
    await ledger.append({
      transactionId: second,
      operations: [insertAt(paraId, 6, '?')],
    });

    const materializer = new EditMaterializer(crdt, ledger);
    const order: string[] = [];
    await materializer.recover(async (edit) => {
      order.push(`commit:${edit.transactionId}`);
      expect((await ledger.listUnapplied()).map((record) => record.transactionId)).toContain(
        edit.transactionId,
      );
    });

    expect(crdt.getCanonicalDocument().content[0]?.content[0]?.text).toBe('Hello!?');
    expect(await ledger.listUnapplied()).toHaveLength(0);
    expect(order).toEqual([`commit:${first}`, `commit:${second}`]);
    expect(materializer.appliedCount()).toBe(2);
    expect(materializer.lastTransactionId()).toBe(second);

    const replica = new YjsCrdtDocument();
    replica.applyUpdate(materializer.lastUpdate());
    expect(canonicalizeDocument(replica.getCanonicalDocument())).toEqual(
      canonicalizeDocument(crdt.getCanonicalDocument()),
    );
  });

  it('leaves a replay unapplied when its durable commit fails', async () => {
    const { document, paraId } = seedParagraph();
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const ledger = new MemoryIntakeLedger();
    const transactionId = createId<TransactionId>();
    await ledger.append({
      transactionId,
      operations: [insertAt(paraId, 5, '!')],
    });

    const materializer = new EditMaterializer(crdt, ledger);
    await expect(
      materializer.recover(() => Promise.reject(new Error('disk full'))),
    ).rejects.toThrow('disk full');

    expect((await ledger.listUnapplied()).map((record) => record.transactionId)).toEqual([
      transactionId,
    ]);
    expect(materializer.appliedCount()).toBe(0);
    expect(materializer.lastTransactionId()).toBeUndefined();
  });

  it('is not invoked for IME composition; canonical Document is unchanged', () => {
    const { document } = seedParagraph();
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const ledger = new MemoryIntakeLedger();
    const materializer = new EditMaterializer(crdt, ledger);
    const before = canonicalizeDocument(crdt.getCanonicalDocument());

    expect(materializer.appliedCount()).toBe(0);
    expect(canonicalizeDocument(crdt.getCanonicalDocument())).toEqual(before);
  });
});
