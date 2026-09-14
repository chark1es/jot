import {
  canonicalizeDocumentToString,
  createId,
  deriveId,
  parseDocument,
  parseId,
  SchemaError,
} from '@jot/schema';
import type {
  Document,
  Mark,
  NodeId,
  SchemaNode,
  SchemaOperation,
  SchemaSelection,
} from '@jot/schema';
import { describe, expect, it } from 'vitest';
import { applyOperations, invertOperations } from './apply-operations.js';
import { documentToLinear, linearToDocument } from './linear.js';

function sel(nodeId: NodeId, offset: number): SchemaSelection {
  return { nodeId, offsetUtf16: offset, affinity: 'after', revision: 0 };
}

function textNode(id: NodeId, text: string, marks: readonly Mark[] = []): SchemaNode {
  return { type: 'text', id, attrs: {}, content: [], marks, text };
}

function paragraph(
  id: NodeId,
  textId: NodeId,
  text: string,
  marks: readonly Mark[] = [],
): SchemaNode {
  return {
    type: 'paragraph',
    id,
    attrs: {},
    content: [textNode(textId, text, marks)],
    marks: [],
  };
}

function simpleDoc(
  text: string,
  marks: readonly Mark[] = [],
): {
  doc: Document;
  paragraphId: NodeId;
  textId: NodeId;
} {
  const paragraphId = createId();
  const textId = createId();
  const doc = parseDocument({
    type: 'doc',
    id: createId(),
    content: [paragraph(paragraphId, textId, text, marks)],
  });
  return { doc, paragraphId, textId };
}

function canonical(doc: Document): string {
  return canonicalizeDocumentToString(doc);
}

function stable(doc: Document): void {
  const once = canonical(doc);
  expect(canonicalizeDocumentToString(parseDocument(JSON.parse(once) as unknown))).toBe(once);
}

describe('applyOperations', () => {
  it('insertText, deleteRange, and replaceRange stay canonical', () => {
    const { doc, paragraphId } = simpleDoc('Hello');
    const inserted = applyOperations(doc, [
      {
        type: 'insertText',
        position: sel(paragraphId, 5),
        text: '!',
        storedMarks: [],
      },
    ]);
    expect(inserted.content[0]?.content[0]?.text).toBe('Hello!');
    stable(inserted);

    const deleted = applyOperations(inserted, [
      {
        type: 'deleteRange',
        from: sel(paragraphId, 1),
        to: sel(paragraphId, 5),
        deletedSlice: { nodes: [] },
      },
    ]);
    expect(deleted.content[0]?.content[0]?.text).toBe('H!');
    stable(deleted);

    const replaced = applyOperations(doc, [
      {
        type: 'replaceRange',
        from: sel(paragraphId, 0),
        to: sel(paragraphId, 5),
        slice: { nodes: [textNode(createId(), 'Hi')] },
        deletedSlice: { nodes: [] },
      },
    ]);
    expect(replaced.content[0]?.content[0]?.text).toBe('Hi');
    stable(replaced);
  });

  it('toggles Phase 1 marks over a range', () => {
    const { doc, paragraphId } = simpleDoc('Hello');
    const bold: Mark = { type: 'bold', attrs: {} };
    const withBold = applyOperations(doc, [
      {
        type: 'addMark',
        range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
        mark: bold,
      },
    ]);
    expect(withBold.content[0]?.content[0]?.marks.some((mark) => mark.type === 'bold')).toBe(true);
    stable(withBold);

    const withoutBold = applyOperations(withBold, [
      {
        type: 'removeMark',
        range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
        markType: 'bold',
      },
    ]);
    expect(canonical(withoutBold)).toBe(canonical(doc));

    const italic: Mark = { type: 'italic', attrs: {} };
    const withItalic = applyOperations(doc, [
      {
        type: 'addMark',
        range: { from: sel(paragraphId, 1), to: sel(paragraphId, 4) },
        mark: italic,
      },
    ]);
    const middle = withItalic.content[0]?.content.find((child) => child.text === 'ell');
    expect(middle?.marks.some((mark) => mark.type === 'italic')).toBe(true);
    const cleared = applyOperations(withItalic, [
      {
        type: 'removeMark',
        range: { from: sel(paragraphId, 1), to: sel(paragraphId, 4) },
        markType: 'italic',
      },
    ]);
    expect(canonical(linearToDocument(documentToLinear(cleared)))).toBe(canonical(cleared));
    stable(cleared);
  });

  it('applies underline, strikethrough, inlineCode, and allowed links', () => {
    const { doc, paragraphId } = simpleDoc('Hello');
    const marked = applyOperations(doc, [
      {
        type: 'addMark',
        range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
        mark: { type: 'underline', attrs: {} },
      },
      {
        type: 'addMark',
        range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
        mark: { type: 'strikethrough', attrs: {} },
      },
      {
        type: 'addMark',
        range: { from: sel(paragraphId, 1), to: sel(paragraphId, 4) },
        mark: { type: 'inlineCode', attrs: {} },
      },
      {
        type: 'addMark',
        range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
        mark: { type: 'link', attrs: { href: 'https://example.com', title: '' } },
      },
    ]);
    const types = new Set(
      marked.content[0]?.content.flatMap((child) => child.marks.map((mark) => mark.type)) ?? [],
    );
    expect(types.has('underline')).toBe(true);
    expect(types.has('strikethrough')).toBe(true);
    expect(types.has('inlineCode')).toBe(true);
    expect(types.has('link')).toBe(true);
    stable(marked);
  });

  it('rejects textColor, highlight, and disallowed link hrefs', () => {
    const { doc, paragraphId } = simpleDoc('Hello');
    expect(() =>
      applyOperations(doc, [
        {
          type: 'addMark',
          range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
          mark: { type: 'textColor', attrs: { paletteId: 'signalAmber' } },
        },
      ]),
    ).toThrow(SchemaError);
    expect(() =>
      applyOperations(doc, [
        {
          type: 'addMark',
          range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
          mark: { type: 'highlight', attrs: { paletteId: 'highlightWarm' } },
        },
      ]),
    ).toThrow(SchemaError);
    expect(() =>
      applyOperations(doc, [
        {
          type: 'addMark',
          range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
          mark: { type: 'link', attrs: { href: 'javascript:alert(1)', title: '' } },
        },
      ]),
    ).toThrow(SchemaError);
    expect(() =>
      applyOperations(doc, [
        {
          type: 'addMark',
          range: { from: sel(paragraphId, 0), to: sel(paragraphId, 5) },
          mark: { type: 'link', attrs: { href: '/relative', title: '' } },
        },
      ]),
    ).toThrow(SchemaError);
  });

  it('splits a list item and joins adjacent items', () => {
    const listId = createId();
    const itemA = createId();
    const paraA = createId();
    const textA = createId();
    const itemB = createId();
    const paraB = createId();
    const textB = createId();
    const doc = parseDocument({
      type: 'doc',
      id: createId(),
      content: [
        {
          type: 'bulletList',
          id: listId,
          content: [
            {
              type: 'listItem',
              id: itemA,
              content: [paragraph(paraA, textA, 'hello world')],
            },
          ],
        },
      ],
    });

    const splitItem: SchemaNode = {
      type: 'listItem',
      id: itemB,
      attrs: {},
      content: [paragraph(paraB, textB, 'world')],
      marks: [],
    };
    const splitOps: SchemaOperation[] = [
      {
        type: 'deleteRange',
        from: sel(paraA, 6),
        to: sel(paraA, 11),
        deletedSlice: { nodes: [] },
      },
      {
        type: 'insertNode',
        parentId: listId,
        index: 1,
        node: splitItem,
      },
    ];
    const split = applyOperations(doc, splitOps);
    const list = split.content[0];
    expect(list?.type).toBe('bulletList');
    expect(list?.content).toHaveLength(2);
    expect(list?.content[0]?.content[0]?.content[0]?.text).toBe('hello ');
    expect(list?.content[1]?.content[0]?.content[0]?.text).toBe('world');
    stable(split);

    const joined = applyOperations(split, [
      {
        type: 'deleteRange',
        from: sel(paraA, 6),
        to: sel(paraB, 0),
        deletedSlice: { nodes: [] },
      },
    ]);
    expect(joined.content[0]?.content).toHaveLength(1);
    const joinedText =
      joined.content[0]?.content[0]?.content[0]?.content
        .map((child) => child.text ?? '')
        .join('') ?? '';
    expect(joinedText).toBe('hello world');
    stable(joined);
  });

  it('toggles taskItem checked 0 and 1', () => {
    const itemId = parseId('ceaaaaaaaaaaaaaaaaaaaaaaaa');
    const doc = parseDocument(
      JSON.parse(
        `{
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [{
            "type": "taskList",
            "id": "caaaaaaaaaaaaaaaaaaaaaaaaa",
            "content": [{
              "type": "taskItem",
              "id": "ceaaaaaaaaaaaaaaaaaaaaaaaa",
              "attrs": { "checked": 0 },
              "content": [{
                "type": "paragraph",
                "id": "ciaaaaaaaaaaaaaaaaaaaaaaaa",
                "content": [{ "type": "text", "id": "cmaaaaaaaaaaaaaaaaaaaaaaaa", "text": "todo", "marks": [] }]
              }]
            }]
          }]
        }`,
      ) as unknown,
    );
    const checked = applyOperations(doc, [
      {
        type: 'setNodeAttributes',
        nodeId: itemId,
        patch: { checked: 1 },
        priorValues: { checked: 0 },
      },
    ]);
    expect(checked.content[0]?.content[0]?.attrs.checked).toBe(1);
    stable(checked);
    const unchecked = applyOperations(checked, [
      {
        type: 'setNodeAttributes',
        nodeId: itemId,
        patch: { checked: 0 },
        priorValues: { checked: 1 },
      },
    ]);
    expect(unchecked.content[0]?.content[0]?.attrs.checked).toBe(0);
    expect(canonical(unchecked)).toBe(canonical(doc));
  });

  it('linearizes a 5000-word document and keeps an insert canonical', () => {
    const words = Array.from({ length: 5000 }, (_, index) => `w${String(index)}`);
    expect(words).toHaveLength(5000);
    const text = words.join(' ');
    const { doc, paragraphId } = simpleDoc(text);
    const linear = documentToLinear(doc);
    expect(linearToDocument(linear).content[0]?.content[0]?.text).toBe(text);
    expect(canonical(linearToDocument(linear))).toBe(canonical(doc));
    const offset = text.split(' ').slice(0, 2500).join(' ').length + 1;
    const edited = applyOperations(doc, [
      {
        type: 'insertText',
        position: sel(paragraphId, offset),
        text: 'INSERTED ',
        storedMarks: [],
      },
    ]);
    stable(edited);
    expect(canonical(linearToDocument(documentToLinear(edited)))).toBe(canonical(edited));
    expect(edited.content[0]?.content[0]?.text?.includes('INSERTED ')).toBe(true);
  });

  it('rejects unpaired surrogates on insert', () => {
    const { doc, paragraphId } = simpleDoc('Hi');
    expect(() =>
      applyOperations(doc, [
        {
          type: 'insertText',
          position: sel(paragraphId, 0),
          text: '\uD800',
          storedMarks: [],
        },
      ]),
    ).toThrow(SchemaError);
  });

  it('applies and inverts the first keystroke into an empty note', () => {
    const docId = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');
    const paraId = deriveId(docId, 'paragraph', 0);
    const textId = deriveId(paraId, 'text', 0);
    const empty = parseDocument({ type: 'doc', id: docId, content: [] });
    const caret = sel(paraId, 0);
    const op: SchemaOperation = {
      type: 'replaceRange',
      from: caret,
      to: caret,
      slice: {
        nodes: [textNode(textId, 'Hi')],
      },
      deletedSlice: { nodes: [] },
    };
    const inverses = invertOperations(empty, [op]);
    expect(inverses.length).toBeGreaterThan(0);
    const typed = applyOperations(empty, [op]);
    expect(typed.content[0]?.id).toBe(paraId);
    expect(typed.content[0]?.content[0]?.text).toBe('Hi');
    const undone = applyOperations(typed, inverses);
    expect(undone.content[0]?.content[0]?.text ?? '').toBe('');
  });

  it('applies and inverts a keystroke whose caret sits on the root of an empty note', () => {
    const docId = createId();
    const empty = parseDocument({ type: 'doc', id: docId, content: [] });
    const op: SchemaOperation = {
      type: 'insertText',
      position: sel(docId, 0),
      text: 'Hello',
      storedMarks: [],
    };
    const inverses = invertOperations(empty, [op]);
    const typed = applyOperations(empty, [op]);
    expect(typed.content[0]?.id).toBe(deriveId(docId, 'paragraph', 0));
    expect(typed.content[0]?.content[0]?.text).toBe('Hello');
    const undone = applyOperations(typed, inverses);
    expect(undone.content[0]?.content[0]?.text ?? '').toBe('');
  });

  it('applies and inverts enter as insertNode after the first paragraph', () => {
    const { doc, paragraphId } = simpleDoc('Hi');
    const newPara = createId();
    const op: SchemaOperation = {
      type: 'insertNode',
      parentId: doc.id,
      index: 1,
      node: {
        type: 'paragraph',
        id: newPara,
        attrs: {},
        content: [],
        marks: [],
      },
    };
    const inverses = invertOperations(doc, [op]);
    const split = applyOperations(doc, [op]);
    expect(split.content).toHaveLength(2);
    expect(split.content[0]?.id).toBe(paragraphId);
    expect(split.content[0]?.content[0]?.text).toBe('Hi');
    expect(split.content[1]?.id).toBe(newPara);
    expect(split.content[1]?.content ?? []).toEqual([]);
    const undone = applyOperations(split, inverses);
    expect(undone.content).toHaveLength(1);
    expect(undone.content[0]?.id).toBe(paragraphId);
  });
});
