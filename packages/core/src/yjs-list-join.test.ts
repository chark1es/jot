import { describe, expect, it } from 'vitest';
import { canonicalizeDocumentToString, createId, deriveId, parseDocument, parseId } from '@jot/schema';
import type { NodeId, TransactionId } from '@jot/schema';
import { YjsCrdtDocument } from './yjs-document.js';

const docId = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');
const id = (purpose: string, index = 0): NodeId => deriveId(docId, purpose, index);

function paragraph(paragraphId: NodeId, text: string, marks: readonly string[] = []) {
  return {
    type: 'paragraph',
    id: paragraphId,
    content: text.length === 0 ? [] : [{ type: 'text', id: deriveId(paragraphId, 'text', 0), text, marks: marks.map((type) => ({ type })) }],
  };
}

function caret(nodeId: NodeId, offsetUtf16: number) {
  return { nodeId, offsetUtf16, affinity: 'after' as const, revision: 0 };
}

describe('YjsCrdtDocument list joins', () => {
  it('joins adjacent task items the way apply-operations does', () => {
    const nested = {
      type: 'bulletList',
      id: id('nested'),
      content: [{ type: 'listItem', id: id('nested-item'), content: [paragraph(id('nested-paragraph'), 'child')] }],
    };
    const crdt = YjsCrdtDocument.fromCanonical(
      parseDocument({
        type: 'doc',
        id: docId,
        content: [
          {
            type: 'taskList',
            id: id('list'),
            content: [
              { type: 'taskItem', id: id('item', 0), attrs: { checked: 0 }, content: [paragraph(id('paragraph', 0), 'a', ['bold'])] },
              { type: 'taskItem', id: id('item', 1), attrs: { checked: 1 }, content: [paragraph(id('paragraph', 1), 'b'), nested] },
            ],
          },
        ],
      }),
    );
    crdt.applySchemaOperations(
      [{ type: 'deleteRange', from: caret(id('paragraph', 0), 1), to: caret(id('paragraph', 1), 0), deletedSlice: { nodes: [] } }],
      createId<TransactionId>(),
    );
    const expected = parseDocument({
      type: 'doc',
      id: docId,
      content: [
        {
          type: 'taskList',
          id: id('list'),
          content: [
            {
              type: 'taskItem',
              id: id('item', 0),
              attrs: { checked: 0 },
              content: [
                {
                  type: 'paragraph',
                  id: id('paragraph', 0),
                  content: [
                    { type: 'text', id: deriveId(id('paragraph', 0), 'text', 0), text: 'a', marks: [{ type: 'bold' }] },
                    { type: 'text', id: deriveId(id('paragraph', 0), 'text', 1), text: 'b', marks: [] },
                  ],
                },
                nested,
              ],
            },
          ],
        },
      ],
    });
    expect(canonicalizeDocumentToString(crdt.getCanonicalDocument())).toBe(canonicalizeDocumentToString(expected));
  });

  it('rejects a range across unrelated paragraphs, like apply-operations', () => {
    const crdt = YjsCrdtDocument.fromCanonical(
      parseDocument({ type: 'doc', id: docId, content: [paragraph(id('paragraph', 0), 'ab'), paragraph(id('paragraph', 1), 'cd')] }),
    );
    expect(() => {
      crdt.applySchemaOperations(
        [{ type: 'deleteRange', from: caret(id('paragraph', 0), 2), to: caret(id('paragraph', 1), 0), deletedSlice: { nodes: [] } }],
        createId<TransactionId>(),
      );
    }).toThrow();
  });
});
