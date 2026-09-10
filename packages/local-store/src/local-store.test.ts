import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createId, deriveId, parseDocument } from '@jot/schema';
import type { NodeId, NoteId, TransactionId } from '@jot/schema';
import { createBunSqliteLocalStore, createMemoryLocalStore } from './bun-sqlite.js';
import { LOCAL_STORE_TABLE_GROUPS, TRASH_RETENTION_MS } from './types.js';
import type { StoreClock } from './types.js';
import { NotImplementedLocalStore } from './not-implemented.js';
import type { LocalStore } from './store.js';

const dirs: string[] = [];

class FakeClock implements StoreClock {
  constructor(private wallMs: number) {}

  advanceMs(deltaMs: number): void {
    this.wallMs += deltaMs;
  }

  wallNow(): { readonly unixMs: number } {
    return { unixMs: this.wallMs };
  }
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jot-local-store-'));
  dirs.push(dir);
  return join(dir, 'vault.sqlite');
}

async function openMemory(clock?: FakeClock): Promise<LocalStore> {
  const store = createMemoryLocalStore(clock === undefined ? {} : { clock });
  await store.open();
  return store;
}

function insertHello(documentId: NodeId, text: string) {
  return {
    type: 'insertText' as const,
    position: {
      nodeId: documentId,
      offsetUtf16: 0,
      affinity: 'after' as const,
      revision: 0,
    },
    text,
    storedMarks: [],
  };
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
        content: [
          {
            type: 'text',
            id: deriveId(paragraphId, 'text', 0),
            text,
            marks: [],
          },
        ],
      },
    ],
  });
}

describe('@jot/local-store', () => {
  it('exports 3.4 table group names', () => {
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('notes');
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('editor_intake');
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('notes_fts');
    expect(LOCAL_STORE_TABLE_GROUPS).toContain('outbox');
    expect(LOCAL_STORE_TABLE_GROUPS).toHaveLength(20);
  });

  it('LocalStore types compile', () => {
    const store: LocalStore = new NotImplementedLocalStore();
    expect(store).toBeInstanceOf(NotImplementedLocalStore);
  });

  it('creates a note, commits an edit, and projects the Document', async () => {
    const clock = new FakeClock(1_000);
    const store = await openMemory(clock);
    const noteId = await store.createNote({ title: 'Hello' });
    const before = await store.getNoteDocument(noteId);
    expect(before?.title).toBe('Hello');
    expect(before).not.toBeNull();
    if (before === null) {
      return;
    }
    const tx = createId<TransactionId>();
    const op = insertHello(before.document.id, 'UniqueBodyToken');
    const document = documentWithText(before.document.id, 'UniqueBodyToken');
    await store.commitEdit({
      transactionId: tx,
      noteId,
      operations: [op],
      crdtUpdate: new Uint8Array([1]),
      document,
      projection: {
        noteId,
        title: 'Hello',
        folderId: null,
        pinned: false,
        archived: false,
        trashed: false,
        plainBody: 'UniqueBodyToken',
      },
      undo: { transactionId: tx, noteId, inverse: new Uint8Array([9, 8, 7]) },
      outbox: { transactionId: tx, noteId, payload: new Uint8Array([1]) },
    });
    const projection = await store.getNoteProjection(noteId);
    expect(projection?.plainBody).toContain('UniqueBodyToken');
    const loaded = await store.getNoteDocument(noteId);
    expect(loaded?.document.content.length).toBeGreaterThan(0);
    await store.close();
  });

  it('survives kill-style reopen with projection, document, and undo', async () => {
    const path = tempPath();
    const clock = new FakeClock(5_000);
    const noteId = createId<NoteId>();
    const tx = createId<TransactionId>();
    const first = createBunSqliteLocalStore({ path, clock });
    await first.open();
    await first.createNote({ noteId, title: 'PersistTitle' });
    const seeded = await first.getNoteDocument(noteId);
    expect(seeded).not.toBeNull();
    if (seeded === null) {
      return;
    }
    const op = insertHello(seeded.document.id, 'PersistedBody');
    await first.commitEdit({
      transactionId: tx,
      noteId,
      operations: [op],
      crdtUpdate: new Uint8Array([2]),
      document: documentWithText(seeded.document.id, 'PersistedBody'),
      projection: {
        noteId,
        title: 'PersistTitle',
        folderId: null,
        pinned: false,
        archived: false,
        trashed: false,
        plainBody: 'PersistedBody',
      },
      undo: { transactionId: tx, noteId, inverse: new Uint8Array([1, 2, 3, 4]) },
      outbox: { transactionId: tx, noteId, payload: new Uint8Array([5]) },
    });
    const deviceId = await first.getDeviceId();
    await first.close();

    const second = createBunSqliteLocalStore({ path, clock });
    await second.open();
    expect(await second.getDeviceId()).toBe(deviceId);
    const projection = await second.getNoteProjection(noteId);
    expect(projection?.title).toBe('PersistTitle');
    expect(projection?.plainBody).toContain('PersistedBody');
    const document = await second.getNoteDocument(noteId);
    expect(document?.title).toBe('PersistTitle');
    const undo = await second.listUndoRedo(noteId, 10);
    expect(undo.undo).toHaveLength(1);
    expect(undo.undo[0]?.transactionId).toBe(tx);
    expect(Array.from(undo.undo[0]?.inverse ?? [])).toEqual([1, 2, 3, 4]);
    await second.close();
  });

  it('search finds title and body', async () => {
    const store = await openMemory();
    const titled = await store.createNote({ title: 'ZebraSearchTitle' });
    const bodyNote = await store.createNote({ title: 'Other' });
    const loaded = await store.getNoteDocument(bodyNote);
    expect(loaded).not.toBeNull();
    if (loaded === null) {
      return;
    }
    const tx = createId<TransactionId>();
    const op = insertHello(loaded.document.id, 'MangoSearchBody');
    await store.commitEdit({
      transactionId: tx,
      noteId: bodyNote,
      operations: [op],
      crdtUpdate: new Uint8Array([3]),
      document: documentWithText(loaded.document.id, 'MangoSearchBody'),
      projection: {
        noteId: bodyNote,
        title: 'Other',
        folderId: null,
        pinned: false,
        archived: false,
        trashed: false,
        plainBody: 'MangoSearchBody',
      },
      undo: { transactionId: tx, noteId: bodyNote, inverse: new Uint8Array([0]) },
      outbox: { transactionId: tx, noteId: bodyNote, payload: new Uint8Array([0]) },
    });
    const titleHits = await store.search({ text: 'ZebraSearchTitle', limit: 50 });
    expect(titleHits.hits.some((hit) => hit.noteId === titled)).toBe(true);
    expect(titleHits.snippets.every((snippet) => !snippet.includes('<'))).toBe(true);
    const bodyHits = await store.search({ text: 'MangoSearchBody', limit: 50 });
    expect(bodyHits.hits.some((hit) => hit.noteId === bodyNote)).toBe(true);
    await store.close();
  });

  it('folder cycle repair removes the newest parent edge and keeps notes', async () => {
    const clock = new FakeClock(10_000);
    const store = await openMemory(clock);
    const a = await store.createFolder({ name: 'A' });
    clock.advanceMs(1);
    const b = await store.createFolder({ name: 'B' });
    clock.advanceMs(1);
    const c = await store.createFolder({ name: 'C' });
    const noteId = await store.createNote({ title: 'Child', folderId: a });
    await store.moveFolder(b, a);
    await store.moveFolder(c, b);
    const repair = await store.moveFolder(a, c);
    expect(repair?.rule).toBe('remove-newest-parent-edge');
    const folders = await store.listFolders();
    expect(folders).toHaveLength(3);
    const notes = await store.listNotes({ folderId: a, trash: 'all', archived: false });
    expect(notes.some((item) => item.noteId === noteId)).toBe(true);
    await store.close();
  });

  it('stores trash 30-day purge field', async () => {
    const clock = new FakeClock(2_000_000);
    const store = await openMemory(clock);
    const noteId = await store.createNote({ title: 'Gone' });
    await store.trashNote(noteId);
    const listed = await store.listNotes({ trash: 'trashed', archived: false });
    expect(listed).toHaveLength(1);
    const item = listed[0];
    expect(item?.trashedAtWallMs).toBe(2_000_000);
    expect(item?.purgeAfterWallMs).toBe(2_000_000 + TRASH_RETENTION_MS);
    await store.close();
  });

  it('tags, versions, attachments, and export snapshot', async () => {
    const store = await openMemory();
    const noteId = await store.createNote({ title: 'Tagged' });
    const tagId = await store.createTag({ name: 'inbox' });
    await store.addTagToNote(noteId, tagId);
    const version = await store.saveVersion(noteId, { label: 'manual' });
    const restored = await store.restoreVersion(noteId, version.id);
    expect(restored.title).toBe('Tagged');
    const attachment = await store.importAttachment({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/png',
      originalName: 'pic.png',
      noteId,
    });
    expect(attachment.byteLength).toBe(4);
    const snapshot = await store.exportVaultSnapshot();
    expect(snapshot.notes.some((note) => note.id === noteId)).toBe(true);
    expect(snapshot.tags.some((tag) => tag.id === tagId)).toBe(true);
    expect(snapshot.attachments.some((row) => row.id === attachment.id)).toBe(true);
    expect(JSON.parse(snapshot.notes[0]?.canonicalJson ?? '{}')).toMatchObject({ type: 'doc' });
    await store.close();
  });

  it('trashing a folder does not trash its notes', async () => {
    const store = await openMemory();
    const folderId = await store.createFolder({ name: 'Keep' });
    const noteId = await store.createNote({ title: 'Still here', folderId });
    await store.trashFolder(folderId);
    expect(await store.listFolders()).toHaveLength(0);
    const notes = await store.listNotes({ folderId, trash: 'active', archived: false });
    expect(notes[0]?.noteId).toBe(noteId);
    expect(notes[0]?.trashed).toBe(false);
    await store.close();
  });
});
