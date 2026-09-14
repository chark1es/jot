import { createId, parseDocument } from '@jot/schema';
import type { NodeId, SchemaSelection, TransactionId } from '@jot/schema';
import { describe, expect, it } from 'vitest';
import { YjsCrdtDocument } from './yjs-document.js';

function caret(nodeId: NodeId, offsetUtf16: number): SchemaSelection {
  return { nodeId, offsetUtf16, affinity: 'after', revision: 0 };
}

function listDocument(listType: 'bulletList' | 'taskList', itemText: string) {
  const ids = { doc: createId(), list: createId(), item: createId(), paragraph: createId() };
  const item = {
    type: listType === 'taskList' ? 'taskItem' : 'listItem',
    id: ids.item,
    attrs: listType === 'taskList' ? { checked: 0 } : {},
    content: [
      {
        type: 'paragraph',
        id: ids.paragraph,
        content: itemText.length === 0 ? [] : [{ type: 'text', id: createId(), text: itemText, marks: [] }],
      },
    ],
  };
  const document = parseDocument({ type: 'doc', id: ids.doc, content: [{ type: listType, id: ids.list, content: [item] }] });
  return { ids, crdt: YjsCrdtDocument.fromCanonical(document) };
}

describe('YjsCrdtDocument carets on list items', () => {
  for (const listType of ['bulletList', 'taskList'] as const) {
    it(`types into the ${listType} item's paragraph when the item is empty`, () => {
      const { ids, crdt } = listDocument(listType, '');
      crdt.applySchemaOperations(
        ['e', 'g', 'g', 's'].map((text, index) => ({
          type: 'insertText',
          position: caret(ids.item, index),
          text,
          storedMarks: [],
        })),
        createId<TransactionId>(),
      );
      const item = crdt.getCanonicalDocument().content[0]?.content[0];
      expect(item?.content).toHaveLength(1);
      expect(item?.content[0]?.id).toBe(ids.paragraph);
      expect(item?.content[0]?.content.map((node) => node.text).join('')).toBe('eggs');
    });

    it(`deletes and marks through the ${listType} item id`, () => {
      const { ids, crdt } = listDocument(listType, 'milk and eggs');
      crdt.applySchemaOperations(
        [
          { type: 'deleteRange', from: caret(ids.item, 4), to: caret(ids.item, 8), deletedSlice: { nodes: [] } },
          { type: 'addMark', range: { from: caret(ids.item, 0), to: caret(ids.item, 4) }, mark: { type: 'bold', attrs: {} } },
        ],
        createId<TransactionId>(),
      );
      const paragraph = crdt.getCanonicalDocument().content[0]?.content[0]?.content[0];
      expect(paragraph?.content.map((node) => node.text).join('')).toBe('milk eggs');
      expect(paragraph?.content[0]?.marks.map((mark) => mark.type)).toEqual(['bold']);
    });
  }
});
