import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createId, deriveId, parseDocument, utf8Encode } from '@jot/schema';
import type { NodeId, NoteId, SchemaOperation, TransactionId } from '@jot/schema';
import { createBunSqliteLocalStore, createMemoryLocalStore } from './bun-sqlite.js';
import type { LocalStore } from './store.js';
import { TRASH_RETENTION_MS, UNDO_HISTORY_LIMIT } from './types.js';
import type { CommitEditInput, HistoryStep, StoreClock } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

class FakeClock implements StoreClock {
  constructor(private wallMs: number) {}

  advanceMs(deltaMs: number): void {
    this.wallMs += deltaMs;
  }

  wallNow(): { readonly unixMs: number } {
    return { unixMs: this.wallMs };
  }
}

function documentWithText(documentId: NodeId, text: string) {
  const paragraphId = deriveId(documentId, 'paragraph', 0);
  return parseDocument({
    type: 'doc',
    id: documentId,
    content: [
      {
        type: 'paragraph',
        id: paragraphId,
        content: [{ type: 'text', id: deriveId(paragraphId, 'text', 0), text, marks: [] }],
      },
    ],
  });
}

async function commitText(
  store: LocalStore,
  noteId: NoteId,
  text: string,
  history?: HistoryStep,
): Promise<TransactionId> {
  const loaded = await store.getNoteDocument(noteId);
  if (loaded === null) {
    throw new Error('note is missing');
  }
  const transactionId = createId<TransactionId>();
  const paragraphId = deriveId(loaded.document.id, 'paragraph', 0);
  const caret = { nodeId: paragraphId, offsetUtf16: 0, affinity: 'after' as const, revision: 0 };
  const forward: SchemaOperation[] = [{ type: 'insertText', position: caret, text, storedMarks: [] }];
  const inverse: SchemaOperation[] = [
    {
      type: 'deleteRange',
      from: caret,
      to: { ...caret, offsetUtf16: text.length },
      deletedSlice: { nodes: [] },
    },
  ];
  const input: CommitEditInput = {
    transactionId,
    noteId,
    operations: forward,
    crdtUpdate: new Uint8Array([1]),
    document: documentWithText(loaded.document.id, text),
    projection: {
      noteId,
      title: text,
      folderId: null,
      pinned: false,
      archived: false,
      trashed: false,
      plainBody: text,
    },
    undo: { transactionId, noteId, inverse: utf8Encode(JSON.stringify(inverse)) },
    outbox: { transactionId, noteId, payload: new Uint8Array([1]) },
    ...(history === undefined ? {} : { history }),
  };
  await store.commitEdit(input);
  return transactionId;
}

async function ids(store: LocalStore, noteId: NoteId) {
  const history = await store.listHistory(noteId, 1000);
  return {
    undo: history.undo.map((entry) => entry.transactionId),
    redo: history.redo.map((entry) => entry.transactionId),
  };
}

describe('persistent undo history', () => {
  it('moves replayed steps between stacks in the order an editor pops them', async () => {
    const store = createMemoryLocalStore();
    await store.open();
    const noteId = await store.createNote();
    const t1 = await commitText(store, noteId, 'one');
    const t2 = await commitText(store, noteId, 'two');
    const t3 = await commitText(store, noteId, 'three');
    expect(await ids(store, noteId)).toEqual({ undo: [t1, t2, t3], redo: [] });

    await commitText(store, noteId, 'undo three', { kind: 'undo', transactionId: t3 });
    expect(await ids(store, noteId)).toEqual({ undo: [t1, t2], redo: [t3] });

    await commitText(store, noteId, 'undo two', { kind: 'undo', transactionId: t2 });
    expect(await ids(store, noteId)).toEqual({ undo: [t1], redo: [t3, t2] });

    await commitText(store, noteId, 'redo two', { kind: 'redo', transactionId: t2 });
    expect(await ids(store, noteId)).toEqual({ undo: [t1, t2], redo: [t3] });

    const t4 = await commitText(store, noteId, 'four');
    expect(await ids(store, noteId)).toEqual({ undo: [t1, t2, t4], redo: [] });

    const history = await store.listHistory(noteId, 10);
    expect(history.undo[2]?.forward[0]).toMatchObject({ type: 'insertText', text: 'four' });
    expect(history.undo[2]?.inverse[0]).toMatchObject({ type: 'deleteRange' });
    await store.close();
  });

  it('keeps at least 100 steps across a reopen and caps each note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jot-history-'));
    dirs.push(dir);
    const path = join(dir, 'vault.sqlite');
    const first = createBunSqliteLocalStore({ path });
    await first.open();
    const noteId = await first.createNote();
    const committed: TransactionId[] = [];
    for (let i = 0; i < UNDO_HISTORY_LIMIT + 5; i += 1) {
      committed.push(await commitText(first, noteId, `edit ${String(i)}`));
    }
    await first.close();

    const second = createBunSqliteLocalStore({ path });
    await second.open();
    const history = await second.listHistory(noteId, 1000);
    expect(UNDO_HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
    expect(history.undo).toHaveLength(UNDO_HISTORY_LIMIT);
    expect(history.undo[0]?.transactionId).toBe(committed[5]);
    expect(history.undo.at(-1)?.transactionId).toBe(committed.at(-1));
    await second.close();
  });
});

describe('note lists, reordering, and trash', () => {
  it('lists snippets, tags, and archived notes together', async () => {
    const store = createMemoryLocalStore();
    await store.open();
    const active = await store.createNote();
    await commitText(store, active, 'Groceries for Sunday');
    const tagId = await store.createTag({ name: 'home' });
    await store.addTagToNote(active, tagId);
    const archived = await store.createNote();
    await store.archiveNote(archived, true);

    const everything = await store.listNotes({ trash: 'all', archived: 'any' });
    expect(everything.map((note) => note.noteId).sort()).toEqual([active, archived].sort());
    const row = everything.find((note) => note.noteId === active);
    expect(row?.snippet).toContain('Groceries for Sunday');
    expect(row?.tagIds).toEqual([tagId]);
    expect((await store.listNotes()).map((note) => note.noteId)).toEqual([active]);
    await store.close();
  });

  it('reorders without changing the modified time', async () => {
    const store = createMemoryLocalStore({ clock: new FakeClock(1_000) });
    await store.open();
    const first = await store.createNote();
    const second = await store.createNote();
    const before = await store.listNotes({ sort: 'manual' });
    const positions = new Map(before.map((note) => [note.noteId, note.manualPosition]));
    await store.reorderNote(first, positions.get(second) ?? '');
    await store.reorderNote(second, positions.get(first) ?? '');
    const after = await store.listNotes({ sort: 'manual' });
    expect(after.map((note) => note.noteId)).toEqual(before.map((note) => note.noteId).reverse());
    expect(after.map((note) => note.modifiedWallMs)).toEqual(before.map((note) => note.modifiedWallMs).reverse());
    await store.close();
  });

  it('purges notes only after 30 days in the trash, with their attachments', async () => {
    const clock = new FakeClock(10 * DAY_MS);
    const store = createMemoryLocalStore({ clock });
    await store.open();
    const older = await store.createNote();
    const newer = await store.createNote();
    await store.importAttachment({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/png',
      originalName: 'photo.png',
      noteId: older,
    });
    await store.trashNote(older);
    clock.advanceMs(10 * DAY_MS);
    await store.trashNote(newer);
    clock.advanceMs(TRASH_RETENTION_MS - 10 * DAY_MS - 1);
    expect(await store.purgeExpiredTrash()).toEqual([]);
    clock.advanceMs(1);
    expect(await store.purgeExpiredTrash()).toEqual([older]);
    expect(await store.getNoteDocument(older)).toBeNull();
    expect(await store.listAttachments()).toEqual([]);
    const remaining = await store.listNotes({ trash: 'all', archived: 'any' });
    expect(remaining.map((note) => note.noteId)).toEqual([newer]);
    clock.advanceMs(10 * DAY_MS);
    expect(await store.purgeExpiredTrash()).toEqual([newer]);
    await store.close();
  });

  it('deletes a note permanently, including its search entry', async () => {
    const store = createMemoryLocalStore();
    await store.open();
    const noteId = await store.createNote();
    await commitText(store, noteId, 'PermanentlyGoneToken');
    expect((await store.search({ text: 'PermanentlyGoneToken', limit: 5 })).hits).toHaveLength(1);
    await store.deleteNotePermanently(noteId);
    expect(await store.getNoteDocument(noteId)).toBeNull();
    expect((await store.search({ text: 'PermanentlyGoneToken', limit: 5 })).hits).toHaveLength(0);
    expect(await store.listHistory(noteId, 10)).toEqual({ undo: [], redo: [] });
    await store.close();
  });
});
