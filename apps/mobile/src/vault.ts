import { createExpoLocalStore } from '@jot/local-store-expo';
import type { CommitEditInput, LocalStore, SearchQuery, SearchResult } from '@jot/local-store';
import type { NoteCommand } from '@jot/core';
import { parseDocument } from '@jot/schema';
import type {
  ClockEvent,
  DeviceId,
  Document,
  FolderId,
  NoteId,
  TagId,
  TransactionId,
} from '@jot/schema';
import { invertOperations } from '@jot/editor-native';
import type { ExportFolder, ExportNote, VaultExportInput } from '@jot/import-export';
import { emptyDocument, plainBodyFromDocument, titleFromDocument } from './document-utils';
import { loadDeviceClock, persistDeviceClock, type DeviceClockState } from './device';
import {
  MemoryVault,
  type VaultFolder,
  type VaultNote,
  type VaultSnapshot,
  type VaultTag,
} from './memory-vault';

export type { VaultFolder, VaultNote, VaultSnapshot, VaultTag };

type NoteListItem = {
  readonly noteId: NoteId;
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly createdWallMs: number;
  readonly modifiedWallMs: number;
  readonly manualPosition: string;
};

type StoreFolder = {
  readonly id: FolderId;
  readonly name: string;
  readonly parentPlacement: FolderId | null;
  readonly manualPosition: string;
  readonly created: ClockEvent;
  readonly modified: ClockEvent;
};

type StoreTag = {
  readonly id: TagId;
  readonly name: string;
};

type StoreVaultSnapshot = {
  readonly notes: readonly {
    readonly id: NoteId;
    readonly title: string;
    readonly folderId: FolderId | null;
    readonly tags: readonly TagId[];
    readonly pinned: boolean;
    readonly archived: boolean;
    readonly canonicalJson: string;
  }[];
  readonly folders: readonly StoreFolder[];
  readonly tags: readonly StoreTag[];
};

/**
 * LocalStore methods the other agents are filling. Dist types may still be Phase 0.
 * Runtime calls go through this shape; missing methods throw NotImplemented.
 */
type Phase1LocalStore = LocalStore & {
  open(): Promise<void>;
  createNote(input?: { readonly folderId?: FolderId | null }): Promise<NoteId>;
  listNotes(query?: {
    readonly trash?: 'active' | 'trashed' | 'all';
  }): Promise<readonly NoteListItem[]>;
  getNoteDocument(
    noteId: NoteId,
  ): Promise<{ readonly document: Document; readonly title: string } | null>;
  applyNoteCommand(command: NoteCommand): Promise<void>;
  createFolder(input: {
    readonly name: string;
    readonly parentPlacement?: FolderId | null;
  }): Promise<FolderId>;
  listFolders(): Promise<readonly StoreFolder[]>;
  renameFolder(folderId: FolderId, name: string): Promise<void>;
  moveFolder(folderId: FolderId, parentPlacement: FolderId | null): Promise<unknown>;
  listTags(): Promise<readonly StoreTag[]>;
  exportVaultSnapshot(): Promise<StoreVaultSnapshot>;
};

function isNotImplemented(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'NotImplementedError' || error.message.includes('NotImplemented');
}

async function tryStore<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (isNotImplemented(error)) {
      return { ok: false };
    }
    throw error;
  }
}

function encodeInverse(operations: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(operations));
}

function parseCanonical(raw: string): Document {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parseDocument(parsed);
  } catch {
    return emptyDocument();
  }
}

function clockEvent(deviceId: DeviceId, wallMs: number, counter: number): ClockEvent {
  return { logical: { counter, deviceId }, wallMs };
}

function fromListItem(item: NoteListItem, tagIds: readonly TagId[]): VaultNote {
  return {
    id: item.noteId,
    title: item.title,
    folderId: item.folderId,
    pinned: item.pinned,
    archived: item.archived,
    trashed: item.trashed,
    plainBody: '',
    createdMs: item.createdWallMs,
    modifiedMs: item.modifiedWallMs,
    manualPosition: item.manualPosition,
    tagIds,
  };
}

function fromFolder(folder: StoreFolder): VaultFolder {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentPlacement,
    manualPosition: folder.manualPosition,
    createdMs: folder.created.wallMs,
    modifiedMs: folder.modified.wallMs,
  };
}

function fromTag(tag: StoreTag): VaultTag {
  return { id: tag.id, name: tag.name };
}

export class VaultSession {
  private constructor(
    readonly store: Phase1LocalStore | null,
    readonly memory: MemoryVault,
    private clock: DeviceClockState,
    readonly usingMemoryFallback: boolean,
  ) {}

  static async open(): Promise<VaultSession> {
    const clock = await loadDeviceClock();
    const memory = new MemoryVault();
    await memory.hydrate();

    let store: Phase1LocalStore | null = null;
    try {
      // Dist LocalStore types may still be Phase 0; the Expo adapter matches this shape.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Phase 0 dist vs Phase 1 interface
      store = createExpoLocalStore() as Phase1LocalStore;
    } catch {
      // No SQLite on this platform; `store` stays null and the file vault below still opens.
    }

    if (store !== null) {
      try {
        await store.open();
      } catch (error) {
        if (!isNotImplemented(error)) {
          store = null;
        }
      }
    }

    const session = new VaultSession(store, memory, clock, store === null);
    await session.refreshFromStore();
    return session;
  }

  get deviceId(): string {
    return this.clock.deviceId;
  }

  snapshot(): VaultSnapshot {
    return this.memory.snapshot();
  }

  private async persistClock(): Promise<void> {
    await persistDeviceClock(this.clock);
  }

  private async persistMemory(): Promise<void> {
    await this.memory.persist();
    await this.persistClock();
  }

  async refreshFromStore(): Promise<void> {
    const store = this.store;
    if (store === null) {
      return;
    }
    const notes = await tryStore(() => store.listNotes({ trash: 'all' }));
    const folders = await tryStore(() => store.listFolders());
    const tags = await tryStore(() => store.listTags());
    if (notes.ok) {
      const tagByNote = new Map<string, readonly TagId[]>();
      for (const existing of this.memory.notes) {
        tagByNote.set(existing.id, existing.tagIds);
      }
      this.memory.replaceFromStore({
        notes: notes.value.map((item) => fromListItem(item, tagByNote.get(item.noteId) ?? [])),
      });
    }
    if (folders.ok) {
      this.memory.replaceFromStore({ folders: folders.value.map(fromFolder) });
    }
    if (tags.ok) {
      this.memory.replaceFromStore({ tags: tags.value.map(fromTag) });
    }
  }

  async createNote(folderId: FolderId | null): Promise<NoteId> {
    const store = this.store;
    if (store !== null) {
      const created = await tryStore(() => store.createNote({ folderId }));
      if (created.ok) {
        await this.refreshFromStore();
        await this.persistMemory();
        return created.value;
      }
    }
    const created = this.memory.createNote(folderId, this.clock);
    this.clock = created.clock;
    await this.persistMemory();
    return created.noteId;
  }

  async getDocument(noteId: NoteId): Promise<Document> {
    const store = this.store;
    if (store !== null) {
      const loaded = await tryStore(() => store.getNoteDocument(noteId));
      if (loaded.ok && loaded.value !== null) {
        this.memory.documents.set(noteId, loaded.value.document);
        return loaded.value.document;
      }
    }
    return this.memory.getDocument(noteId) ?? emptyDocument();
  }

  async commitEdit(input: {
    readonly noteId: NoteId;
    readonly transactionId: TransactionId;
    readonly operations: CommitEditInput['operations'];
    readonly crdtUpdate: Uint8Array;
    readonly document: Document;
    readonly baseDocument: Document;
  }): Promise<void> {
    this.clock = this.memory.putDocument(input.noteId, input.document, this.clock);
    const note = this.memory.notes.find((entry) => entry.id === input.noteId);
    const projection = {
      noteId: input.noteId,
      title: note?.title ?? titleFromDocument(input.document),
      folderId: note?.folderId ?? null,
      pinned: note?.pinned ?? false,
      archived: note?.archived ?? false,
      trashed: note?.trashed ?? false,
      plainBody: note?.plainBody ?? plainBodyFromDocument(input.document),
    };
    const inverse = invertOperations(input.baseDocument, input.operations);
    const payload: CommitEditInput = {
      transactionId: input.transactionId,
      noteId: input.noteId,
      operations: input.operations,
      crdtUpdate: input.crdtUpdate,
      document: input.document,
      projection,
      undo: {
        transactionId: input.transactionId,
        noteId: input.noteId,
        inverse: encodeInverse(inverse),
      },
      outbox: {
        transactionId: input.transactionId,
        noteId: input.noteId,
        payload: input.crdtUpdate,
      },
    };
    if (this.store !== null) {
      const store = this.store;
      await tryStore(() => store.commitEdit(payload));
    }
    await this.persistMemory();
  }

  async applyNoteCommand(command: NoteCommand): Promise<void> {
    this.clock = this.memory.applyNoteCommand(command, this.clock);
    const store = this.store;
    if (store !== null) {
      const applied = await tryStore(() => store.applyNoteCommand(command));
      if (applied.ok) {
        await this.refreshFromStore();
      }
    }
    await this.persistMemory();
  }

  async createFolder(name: string, parentId: FolderId | null): Promise<FolderId> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Folder name cannot be empty.');
    }
    const store = this.store;
    if (store !== null) {
      const created = await tryStore(() =>
        store.createFolder({ name: trimmed, parentPlacement: parentId }),
      );
      if (created.ok) {
        await this.refreshFromStore();
        await this.persistMemory();
        return created.value;
      }
    }
    const created = this.memory.createFolder(trimmed, parentId, this.clock);
    this.clock = created.clock;
    await this.persistMemory();
    return created.folderId;
  }

  async renameFolder(folderId: FolderId, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Folder name cannot be empty.');
    }
    const store = this.store;
    if (store !== null) {
      const renamed = await tryStore(() => store.renameFolder(folderId, trimmed));
      if (renamed.ok) {
        await this.refreshFromStore();
        await this.persistMemory();
        return;
      }
    }
    this.clock = this.memory.renameFolder(folderId, trimmed, this.clock);
    await this.persistMemory();
  }

  async moveFolder(folderId: FolderId, parentId: FolderId | null): Promise<void> {
    const store = this.store;
    if (store !== null) {
      const moved = await tryStore(() => store.moveFolder(folderId, parentId));
      if (moved.ok) {
        await this.refreshFromStore();
        await this.persistMemory();
        return;
      }
    }
    this.clock = this.memory.moveFolder(folderId, parentId, this.clock);
    await this.persistMemory();
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const store = this.store;
    if (store !== null) {
      const result = await tryStore(() => store.search(query));
      if (result.ok) {
        return result.value;
      }
    }
    const needle = query.text.trim().toLowerCase();
    if (needle.length === 0) {
      return { hits: [], snippets: [] };
    }
    const hits = this.memory.notes
      .filter((note) => !note.trashed)
      .filter((note) => `${note.title}\n${note.plainBody}`.toLowerCase().includes(needle))
      .slice(0, query.limit)
      .map((note) => {
        const source = note.plainBody.length > 0 ? note.plainBody : note.title;
        const index = source.toLowerCase().indexOf(needle);
        const start = Math.max(0, index - 24);
        const snippet = source
          .slice(start, start + 80)
          .replace(/\s+/g, ' ')
          .trim();
        return { noteId: note.id, snippet };
      });
    return { hits, snippets: hits.map((hit) => hit.snippet) };
  }

  async exportForShare(): Promise<VaultExportInput> {
    const store = this.store;
    if (store !== null) {
      const snapshot = await tryStore(() => store.exportVaultSnapshot());
      if (snapshot.ok) {
        const notes: ExportNote[] = snapshot.value.notes.map((note, index) => {
          const created = clockEvent(this.clock.deviceId, Date.now(), index + 1);
          return {
            id: note.id,
            title: note.title,
            document: parseCanonical(note.canonicalJson),
            folderPlacement: note.folderId,
            tags: note.tags.map((tagId) => {
              const tag = snapshot.value.tags.find((entry) => entry.id === tagId);
              return { id: tagId, name: tag?.name ?? tagId };
            }),
            pinned: note.pinned,
            archived: note.archived,
            created,
            modified: created,
            attachments: [],
          };
        });
        const folders: ExportFolder[] = snapshot.value.folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          parentPlacement: folder.parentPlacement,
          manualPosition: folder.manualPosition,
        }));
        return { notes, folders };
      }
    }
    return this.memoryToExportInput();
  }

  private memoryToExportInput(): VaultExportInput {
    const snapshot = this.memory.snapshot();
    const notes: ExportNote[] = snapshot.notes.map((note, index) => {
      const created = clockEvent(this.clock.deviceId, note.createdMs, index + 1);
      const modified = clockEvent(this.clock.deviceId, note.modifiedMs, index + 1);
      return {
        id: note.id,
        title: note.title.trim() === '' ? 'Untitled' : note.title,
        document: snapshot.documents[note.id] ?? emptyDocument(),
        folderPlacement: note.folderId,
        tags: note.tagIds.map((tagId) => {
          const tag = snapshot.tags.find((entry) => entry.id === tagId);
          return { id: tagId, name: tag?.name ?? tagId };
        }),
        pinned: note.pinned,
        archived: note.archived,
        created,
        modified,
        attachments: [],
      };
    });
    const folders: ExportFolder[] = snapshot.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentPlacement: folder.parentId,
      manualPosition: folder.manualPosition,
    }));
    return { notes, folders };
  }

  ensureTag(name: string): VaultTag {
    return this.memory.ensureTag(name);
  }
}
