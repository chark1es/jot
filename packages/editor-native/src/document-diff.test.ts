import { canonicalizeDocumentToString, createId, parseDocument } from '@jot/schema';
import type { Document } from '@jot/schema';
import { describe, expect, it } from 'vitest';
import { applyOperations } from './apply-operations.js';
import { documentDiffOperations } from './document-diff.js';

function paragraph(id: string, text: string) {
  return {
    type: 'paragraph',
    id,
    content: text.length === 0 ? [] : [{ type: 'text', id: `${id.slice(0, 25)}q`, text, marks: [] }],
  };
}

function doc(id: string, blocks: readonly ReturnType<typeof paragraph>[]): Document {
  return parseDocument({ type: 'doc', id, content: blocks });
}

describe('documentDiffOperations', () => {
  it('replaces only the blocks that differ and reproduces the target', () => {
    const docId = createId();
    const [a, b, c, d] = [createId(), createId(), createId(), createId()];
    const current = doc(docId, [paragraph(a, 'one'), paragraph(b, 'two'), paragraph(c, 'three')]);
    const version = doc(docId, [paragraph(a, 'one'), paragraph(b, 'TWO'), paragraph(d, 'four'), paragraph(c, 'three')]);
    const operations = documentDiffOperations(current, version);
    expect(operations.map((operation) => operation.type)).toEqual(['deleteNode', 'insertNode', 'insertNode']);
    expect(canonicalizeDocumentToString(applyOperations(current, operations))).toBe(
      canonicalizeDocumentToString(version),
    );
  });

  it('returns nothing for identical documents', () => {
    const docId = createId();
    const same = doc(docId, [paragraph(createId(), 'same')]);
    expect(documentDiffOperations(same, parseDocument(JSON.parse(JSON.stringify(same)) as unknown))).toEqual([]);
  });
});
