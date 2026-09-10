import {
  canonicalizeDocumentToString,
  createId,
  parseDocument,
  SCHEMA_VERSION,
  SchemaError,
} from '@jot/schema';
import type { AttachmentId, Document, NodeId, NoteId, SchemaOperation, TransactionId } from '@jot/schema';
import { describe, expect, it } from 'vitest';
import type { DurableIntake, DurableIntakeRecord } from './durable-intake.js';
import { MemoryDurableIntake } from './durable-intake.js';
import { HeadlessEditorHost } from './headless-host.js';
import type { DocumentRevision, EditorEvent, EditorTransaction } from './index.js';

function revision(value: number): DocumentRevision {
  return value as DocumentRevision;
}

function paragraphDoc(text: string): { doc: Document; paragraphId: NodeId } {
  const paragraphId = createId();
  const doc = parseDocument({
    type: 'doc',
    id: createId(),
    content: [
      {
        type: 'paragraph',
        id: paragraphId,
        content: [{ type: 'text', id: createId(), text, marks: [] }],
      },
    ],
  });
  return { doc, paragraphId };
}

class ThrowingIntake implements DurableIntake {
  append(_record: DurableIntakeRecord): Promise<void> {
    return Promise.reject(new Error('append failed'));
  }

  listUnapplied(): Promise<readonly DurableIntakeRecord[]> {
    return Promise.resolve([]);
  }

  markApplied(_id: TransactionId): Promise<void> {
    return Promise.resolve();
  }
}

describe('HeadlessEditorHost', () => {
  it('does not emit committedTransaction during composition; one replaceRange on commit; none on cancel', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 0,
    });

    await host.beginComposition();
    const composingInsert: EditorTransaction = {
      transactionId: createId<TransactionId>(),
      operations: [
        {
          type: 'insertText',
          position: {
            nodeId: paragraphId,
            offsetUtf16: 2,
            affinity: 'after',
            revision: 0,
          },
          text: 'あ',
          storedMarks: [],
        },
      ],
    };
    await host.applyTransactions(noteId, revision(0), [composingInsert], 'local');
    expect(events.filter((event) => event.type === 'committedTransaction')).toHaveLength(0);
    expect(canonicalizeDocumentToString((await host.getDocumentSnapshot()).canonicalDocument)).toBe(
      canonicalizeDocumentToString(doc),
    );

    await host.endComposition(true);
    const committed = events.filter((event) => event.type === 'committedTransaction');
    expect(committed).toHaveLength(1);
    const first = committed[0];
    expect(first?.type).toBe('committedTransaction');
    if (first?.type === 'committedTransaction') {
      expect(first.operations).toHaveLength(1);
      expect(first.operations[0]?.type).toBe('replaceRange');
    }
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[0]?.content[0]?.text).toBe(
      'Hiあ',
    );

    const cancelHost = new HeadlessEditorHost();
    const cancelEvents: EditorEvent[] = [];
    cancelHost.subscribe((event) => cancelEvents.push(event));
    await cancelHost.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await cancelHost.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 0,
    });
    await cancelHost.beginComposition();
    await cancelHost.applyTransactions(noteId, revision(0), [composingInsert], 'local');
    await cancelHost.endComposition(false);
    expect(cancelEvents.filter((event) => event.type === 'committedTransaction')).toHaveLength(0);
    expect(
      canonicalizeDocumentToString((await cancelHost.getDocumentSnapshot()).canonicalDocument),
    ).toBe(canonicalizeDocumentToString(doc));
  });

  it('appends durable intake before ack and leaves the snapshot unchanged when append throws', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const intake = new MemoryDurableIntake();
    const host = new HeadlessEditorHost(intake);
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    const insert: SchemaOperation = {
      type: 'insertText',
      position: { nodeId: paragraphId, offsetUtf16: 2, affinity: 'after', revision: 0 },
      text: '!',
      storedMarks: [],
    };
    await host.applyTransactions(
      noteId,
      revision(0),
      [{ transactionId: createId<TransactionId>(), operations: [insert] }],
      'local',
    );
    expect(await intake.listUnapplied()).toHaveLength(0);
    expect(events.some((event) => event.type === 'committedTransaction')).toBe(true);

    const throwing = new HeadlessEditorHost(new ThrowingIntake());
    const throwEvents: EditorEvent[] = [];
    throwing.subscribe((event) => throwEvents.push(event));
    await throwing.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await expect(
      throwing.applyTransactions(
        noteId,
        revision(0),
        [{ transactionId: createId<TransactionId>(), operations: [insert] }],
        'local',
      ),
    ).rejects.toThrow('append failed');
    expect(throwEvents.filter((event) => event.type === 'committedTransaction')).toHaveLength(0);
    expect(
      canonicalizeDocumentToString((await throwing.getDocumentSnapshot()).canonicalDocument),
    ).toBe(canonicalizeDocumentToString(doc));
  });

  it('toggles bold on a collapsed selection without a committed edit', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 0,
    });
    await host.dispatchCommand({ name: 'toggleBold' });
    expect(events.filter((event) => event.type === 'committedTransaction')).toHaveLength(0);
    const changed = events.filter((event) => event.type === 'selectionChanged').at(-1);
    expect(changed?.type).toBe('selectionChanged');
    if (changed?.type === 'selectionChanged') {
      expect(changed.activeMarks.some((mark) => mark.type === 'bold')).toBe(true);
    }
    expect(canonicalizeDocumentToString((await host.getDocumentSnapshot()).canonicalDocument)).toBe(
      canonicalizeDocumentToString(doc),
    );
  });

  it('toggles a task item checked through the command', async () => {
    const itemId = createId();
    const paragraphId = createId();
    const doc = parseDocument({
      type: 'doc',
      id: createId(),
      content: [
        {
          type: 'taskList',
          id: createId(),
          content: [
            {
              type: 'taskItem',
              id: itemId,
              attrs: { checked: 0 },
              content: [
                {
                  type: 'paragraph',
                  id: paragraphId,
                  content: [{ type: 'text', id: createId(), text: 'todo', marks: [] }],
                },
              ],
            },
          ],
        },
      ],
    });
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 0,
      affinity: 'after',
      revision: 0,
    });
    await host.dispatchCommand({ name: 'toggleTaskItemChecked' });
    const snapshot = await host.getDocumentSnapshot();
    expect(snapshot.canonicalDocument.content[0]?.content[0]?.attrs.checked).toBe(1);
  });

  it('queues remote transactions until composition ends', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 0,
    });
    await host.beginComposition();
    await host.applyTransactions(
      noteId,
      revision(0),
      [
        {
          transactionId: createId<TransactionId>(),
          operations: [
            {
              type: 'insertText',
              position: {
                nodeId: paragraphId,
                offsetUtf16: 0,
                affinity: 'after',
                revision: 0,
              },
              text: 'z',
              storedMarks: [],
            },
          ],
        },
      ],
      'remote',
    );
    expect(events.filter((event) => event.type === 'committedTransaction')).toHaveLength(0);
    await host.endComposition(false);
    const committed = events.filter((event) => event.type === 'committedTransaction');
    expect(committed).toHaveLength(1);
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[0]?.content[0]?.text).toBe(
      'zHi',
    );
  });

  it('toggles underline, strikethrough, and inlineCode on a collapsed selection', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 0,
    });
    await host.dispatchCommand({ name: 'toggleUnderline' });
    await host.dispatchCommand({ name: 'toggleStrikethrough' });
    await host.dispatchCommand({ name: 'toggleInlineCode' });
    const changed = events.filter((event) => event.type === 'selectionChanged').at(-1);
    expect(changed?.type).toBe('selectionChanged');
    if (changed?.type === 'selectionChanged') {
      expect(changed.activeMarks.map((mark) => mark.type)).toEqual([
        'underline',
        'strikethrough',
        'inlineCode',
      ]);
    }
    expect(events.filter((event) => event.type === 'committedTransaction')).toHaveLength(0);
  });

  it('stores an allowed link and rejects a disallowed href', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 2,
      affinity: 'after',
      revision: 0,
    });
    await host.dispatchCommand({ name: 'setLink', href: 'https://example.com', title: 'Ex' });
    const linked = events.filter((event) => event.type === 'selectionChanged').at(-1);
    expect(linked?.type).toBe('selectionChanged');
    if (linked?.type === 'selectionChanged') {
      expect(linked.activeMarks).toEqual([
        { type: 'link', attrs: { href: 'https://example.com', title: 'Ex' } },
      ]);
    }
    await host.dispatchCommand({ name: 'unsetLink' });
    const cleared = events.filter((event) => event.type === 'selectionChanged').at(-1);
    expect(cleared?.type).toBe('selectionChanged');
    if (cleared?.type === 'selectionChanged') {
      expect(cleared.activeMarks).toEqual([]);
    }
    await expect(
      host.dispatchCommand({ name: 'setLink', href: 'javascript:alert(1)' }),
    ).rejects.toBeInstanceOf(SchemaError);
  });

  it('toggles a blockquote, inserts a divider and image, and undoes with persisted inverses', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const intake = new MemoryDurableIntake();
    const host = new HeadlessEditorHost(intake);
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.setSelection({
      nodeId: paragraphId,
      offsetUtf16: 0,
      affinity: 'after',
      revision: 0,
    });
    await host.dispatchCommand({ name: 'toggleBlockquote' });
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[0]?.type).toBe(
      'blockquote',
    );
    await host.dispatchCommand({ name: 'toggleBlockquote' });
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[0]?.type).toBe(
      'paragraph',
    );
    await host.dispatchCommand({ name: 'insertHorizontalRule' });
    const afterHr = (await host.getDocumentSnapshot()).canonicalDocument;
    expect(afterHr.content[1]?.type).toBe('horizontalRule');
    const attachmentId = createId<AttachmentId>();
    await host.dispatchCommand({ name: 'insertImage', attachmentId, alt: 'photo' });
    const afterImage = (await host.getDocumentSnapshot()).canonicalDocument;
    expect(afterImage.content[1]?.type).toBe('image');
    expect(afterImage.content[1]?.attrs.attachmentId).toBe(attachmentId);
    expect(afterImage.content[1]?.attrs.alt).toBe('photo');
    expect(afterImage.content[2]?.type).toBe('horizontalRule');
    const committed = events.filter((event) => event.type === 'committedTransaction');
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((event) => event.inverses.length > 0)).toBe(true);
    expect(await intake.listUnapplied()).toHaveLength(0);
    await host.undo();
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[1]?.type).toBe(
      'horizontalRule',
    );
    await host.redo();
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[1]?.type).toBe('image');
  });

  it('fires Markdown input rules after space, including blockquote', async () => {
    async function convert(marker: string): Promise<Document> {
      const { doc, paragraphId } = paragraphDoc(marker);
      const host = new HeadlessEditorHost();
      const noteId = createId<NoteId>();
      await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
      await host.applyTransactions(
        noteId,
        revision(0),
        [
          {
            transactionId: createId<TransactionId>(),
            operations: [
              {
                type: 'insertText',
                position: {
                  nodeId: paragraphId,
                  offsetUtf16: marker.length,
                  affinity: 'after',
                  revision: 0,
                },
                text: ' ',
                storedMarks: [],
              },
            ],
          },
        ],
        'local',
      );
      return (await host.getDocumentSnapshot()).canonicalDocument;
    }

    expect((await convert('#')).content[0]?.type).toBe('heading');
    expect((await convert('#')).content[0]?.attrs.level).toBe(1);
    expect((await convert('-')).content[0]?.type).toBe('bulletList');
    expect((await convert('>')).content[0]?.type).toBe('blockquote');
    expect((await convert('```')).content[0]?.type).toBe('codeBlock');
    expect((await convert('1.')).content[0]?.type).toBe('orderedList');
    expect((await convert('[]')).content[0]?.type).toBe('taskList');
  });

  it('does not fire input rules until space or enter, or for remote inserts', async () => {
    const { doc, paragraphId } = paragraphDoc('#');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.applyTransactions(
      noteId,
      revision(0),
      [
        {
          transactionId: createId<TransactionId>(),
          operations: [
            {
              type: 'insertText',
              position: { nodeId: paragraphId, offsetUtf16: 1, affinity: 'after', revision: 0 },
              text: 'x',
              storedMarks: [],
            },
          ],
        },
      ],
      'local',
    );
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[0]?.type).toBe('paragraph');

    const remote = new HeadlessEditorHost();
    await remote.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await remote.applyTransactions(
      noteId,
      revision(0),
      [
        {
          transactionId: createId<TransactionId>(),
          operations: [
            {
              type: 'insertText',
              position: { nodeId: paragraphId, offsetUtf16: 1, affinity: 'after', revision: 0 },
              text: ' ',
              storedMarks: [],
            },
          ],
        },
      ],
      'remote',
    );
    expect((await remote.getDocumentSnapshot()).canonicalDocument.content[0]?.type).toBe(
      'paragraph',
    );
  });

  it('pastes with a single replaceRange transaction', async () => {
    const { doc, paragraphId } = paragraphDoc('Hi');
    const host = new HeadlessEditorHost();
    const noteId = createId<NoteId>();
    const events: EditorEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.loadDocument(noteId, doc, SCHEMA_VERSION, revision(0));
    await host.applyTransactions(
      noteId,
      revision(0),
      [
        {
          transactionId: createId<TransactionId>(),
          operations: [
            {
              type: 'replaceRange',
              from: { nodeId: paragraphId, offsetUtf16: 0, affinity: 'after', revision: 0 },
              to: { nodeId: paragraphId, offsetUtf16: 2, affinity: 'after', revision: 0 },
              slice: {
                nodes: [
                  {
                    type: 'text',
                    id: createId(),
                    attrs: {},
                    content: [],
                    marks: [],
                    text: 'pasted',
                  },
                ],
              },
              deletedSlice: { nodes: [] },
            },
          ],
        },
      ],
      'local',
    );
    const committed = events.filter((event) => event.type === 'committedTransaction');
    expect(committed).toHaveLength(1);
    if (committed[0]?.type === 'committedTransaction') {
      expect(committed[0].operations).toHaveLength(1);
      expect(committed[0].operations[0]?.type).toBe('replaceRange');
      expect(committed[0].inverses).toHaveLength(1);
    }
    expect((await host.getDocumentSnapshot()).canonicalDocument.content[0]?.content[0]?.text).toBe(
      'pasted',
    );
  });
});
