import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeDocument,
  createId,
  deriveId,
  parseDocument,
  parseId,
} from '@jot/schema';
import type { NodeId, TransactionId } from '@jot/schema';
import { UnsupportedCrdtDocument } from './crdt.js';
import { YjsCrdtDocument } from './yjs-document.js';

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

describe('YjsCrdtDocument', () => {
  it('replicates insertText: encodeUpdate then applyUpdate is byte-identical', () => {
    const { document, paraId } = seedParagraph();
    const a = YjsCrdtDocument.fromCanonical(document);
    const b = new YjsCrdtDocument();
    b.applyUpdate(a.encodeUpdate());

    a.applySchemaOperations([insertAt(paraId, 5, '!')], createId<TransactionId>());
    b.applyUpdate(a.encodeUpdate(b.getStateVector()));

    expect(canonicalizeDocument(a.getCanonicalDocument())).toEqual(
      canonicalizeDocument(b.getCanonicalDocument()),
    );
    expect(a.getCanonicalDocument().content[0]?.content[0]?.text).toBe('Hello!');
  });

  it('converges after concurrent inserts', () => {
    const { document, paraId } = seedParagraph();
    const a = YjsCrdtDocument.fromCanonical(document);
    const b = new YjsCrdtDocument();
    b.applyUpdate(a.encodeUpdate());

    a.applySchemaOperations([insertAt(paraId, 5, 'A')], createId<TransactionId>());
    b.applySchemaOperations([insertAt(paraId, 0, 'B')], createId<TransactionId>());

    const fromA = a.encodeUpdate(b.getStateVector());
    const fromB = b.encodeUpdate(a.getStateVector());
    b.applyUpdate(fromA);
    a.applyUpdate(fromB);

    expect(canonicalizeDocument(a.getCanonicalDocument())).toEqual(
      canonicalizeDocument(b.getCanonicalDocument()),
    );
    const merged = a.getCanonicalDocument().content[0]?.content[0]?.text ?? '';
    expect(merged.includes('A')).toBe(true);
    expect(merged.includes('B')).toBe(true);
    expect(merged.includes('Hello')).toBe(true);
  });

  it('merges concurrent title Y.Text edits', () => {
    const a = new YjsCrdtDocument();
    const b = new YjsCrdtDocument();
    a.insertTitleText(0, 'Hello');
    b.insertTitleText(0, 'World');
    b.applyUpdate(a.encodeUpdate());
    a.applyUpdate(b.encodeUpdate());
    expect(a.getTitle()).toBe(b.getTitle());
    expect(a.getTitle().includes('Hello')).toBe(true);
    expect(a.getTitle().includes('World')).toBe(true);
  });

  it('duplicate transactionId is a no-op', () => {
    const { document, paraId } = seedParagraph();
    const a = YjsCrdtDocument.fromCanonical(document);
    const tx = createId<TransactionId>();
    a.applySchemaOperations([insertAt(paraId, 5, '!')], tx);
    const once = canonicalizeDocument(a.getCanonicalDocument());
    a.applySchemaOperations([insertAt(paraId, 5, '!')], tx);
    expect(canonicalizeDocument(a.getCanonicalDocument())).toEqual(once);
  });

  it('UnsupportedCrdtDocument.applySchemaOperations throws', () => {
    const doc = new UnsupportedCrdtDocument();
    expect(() => {
      doc.applySchemaOperations([], createId<TransactionId>());
    }).toThrow('not implemented');
  });

  it('maps Phase 1 marks onto Yjs attributes', () => {
    const { document, paraId } = seedParagraph('Hello');
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const range = {
      from: { nodeId: paraId, offsetUtf16: 0, affinity: 'after' as const, revision: 0 },
      to: { nodeId: paraId, offsetUtf16: 5, affinity: 'after' as const, revision: 0 },
    };
    crdt.applySchemaOperations(
      [
        { type: 'addMark', range, mark: { type: 'underline', attrs: {} } },
        { type: 'addMark', range, mark: { type: 'strikethrough', attrs: {} } },
        { type: 'addMark', range, mark: { type: 'inlineCode', attrs: {} } },
        {
          type: 'addMark',
          range,
          mark: { type: 'link', attrs: { href: 'https://jot.example', title: 'Jot' } },
        },
      ],
      createId<TransactionId>(),
    );
    const marks = crdt.getCanonicalDocument().content[0]?.content[0]?.marks ?? [];
    const types = new Set(marks.map((mark) => mark.type));
    expect(types.has('underline')).toBe(true);
    expect(types.has('strikethrough')).toBe(true);
    expect(types.has('inlineCode')).toBe(true);
    expect(types.has('link')).toBe(true);
    const link = marks.find((mark) => mark.type === 'link');
    expect(link?.attrs.href).toBe('https://jot.example');
    expect(link?.attrs.title).toBe('Jot');
    expect(types.has('textColor')).toBe(false);
    expect(types.has('highlight')).toBe(false);
  });

  it('does not export Y from the public index', async () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
    expect(source.includes("from 'yjs'")).toBe(false);
    expect(source.includes('from "yjs"')).toBe(false);
    expect(/\bexport\s+\{[^}]*\bY\b/.test(source)).toBe(false);
    const mod: Record<string, unknown> = await import('./index.js');
    expect(Object.hasOwn(mod, 'Y')).toBe(false);
  });

  it('applies the first keystroke into an empty note at the derived paragraph id', () => {
    const paraId = deriveId(docId, 'paragraph', 0);
    const textId = deriveId(paraId, 'text', 0);
    const crdt = YjsCrdtDocument.fromCanonical(
      parseDocument({
        type: 'doc',
        id: docId,
        content: [],
      }),
    );
    const caret = {
      nodeId: paraId,
      offsetUtf16: 0,
      affinity: 'after' as const,
      revision: 0,
    };
    crdt.applySchemaOperations(
      [
        {
          type: 'replaceRange',
          from: caret,
          to: caret,
          slice: {
            nodes: [
              {
                type: 'text',
                id: textId,
                attrs: {},
                content: [],
                text: 'Hi',
                marks: [],
              },
            ],
          },
          deletedSlice: { nodes: [] },
        },
      ],
      createId<TransactionId>(),
    );
    const canonical = crdt.getCanonicalDocument();
    expect(canonical.content[0]?.id).toBe(paraId);
    expect(canonical.content[0]?.content[0]?.text).toBe('Hi');
  });

  it('insertText into an empty note at the derived paragraph id creates the paragraph', () => {
    const paraId = deriveId(docId, 'paragraph', 0);
    const crdt = YjsCrdtDocument.fromCanonical(
      parseDocument({
        type: 'doc',
        id: docId,
        content: [],
      }),
    );
    crdt.applySchemaOperations([insertAt(paraId, 0, 'A')], createId<TransactionId>());
    expect(crdt.getCanonicalDocument().content[0]?.content[0]?.text).toBe('A');
  });

  it('inserts a second paragraph on enter after the first keystroke', () => {
    const { document, paraId } = seedParagraph('Hi');
    const crdt = YjsCrdtDocument.fromCanonical(document);
    const newPara = createId();
    crdt.applySchemaOperations(
      [
        {
          type: 'insertNode',
          parentId: docId,
          index: 1,
          node: {
            type: 'paragraph',
            id: newPara,
            attrs: {},
            content: [],
            marks: [],
          },
        },
      ],
      createId<TransactionId>(),
    );
    const canonical = crdt.getCanonicalDocument();
    expect(canonical.content).toHaveLength(2);
    expect(canonical.content[0]?.id).toBe(paraId);
    expect(canonical.content[0]?.content[0]?.text).toBe('Hi');
    expect(canonical.content[1]?.id).toBe(newPara);
  });
});
