import { createId, parseDocument, parseId } from '@jot/schema';
import type { Document, FolderId, NoteId, TagId } from '@jot/schema';
import type { NoteCommand } from '@jot/core';
import { emptyDocument, plainBodyFromDocument, titleFromDocument } from './document-utils';
import { tickClock, type DeviceClockState } from './device';
import { readJsonFile, writeJsonFile } from './persist';

const VAULT_FILE = 'jot-vault.json';

export type VaultNote = {
  readonly id: NoteId;
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly plainBody: string;
  readonly createdMs: number;
  readonly modifiedMs: number;
  readonly manualPosition: string;
  readonly tagIds: readonly TagId[];
};

export type VaultFolder = {
  readonly id: FolderId;
  readonly name: string;
  readonly parentId: FolderId | null;
  readonly manualPosition: string;
  readonly createdMs: number;
  readonly modifiedMs: number;
};

export type VaultTag = {
  readonly id: TagId;
  readonly name: string;
};

export type VaultSnapshot = {
  readonly notes: readonly VaultNote[];
  readonly folders: readonly VaultFolder[];
  readonly tags: readonly VaultTag[];
  readonly documents: Readonly<Record<string, Document>>;
};

type SerializedVault = {
  readonly notes: readonly VaultNote[];
  readonly folders: readonly VaultFolder[];
  readonly tags: readonly VaultTag[];
  readonly documents: Readonly<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseStoredNote(value: unknown): VaultNote | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return undefined;
  }
  try {
    const tagIds = Array.isArray(value.tagIds)
      ? value.tagIds.filter((id): id is string => typeof id === 'string').map((id) => parseId<TagId>(id))
      : [];
    return {
      id: parseId<NoteId>(value.id),
      title: readString(value.title, ''),
      folderId: typeof value.folderId === 'string' ? parseId<FolderId>(value.folderId) : null,
      pinned: readBoolean(value.pinned, false),
      archived: readBoolean(value.archived, false),
      trashed: readBoolean(value.trashed, false),
      plainBody: readString(value.plainBody, ''),
      createdMs: readNumber(value.createdMs, 0),
      modifiedMs: readNumber(value.modifiedMs, 0),
      manualPosition: readString(value.manualPosition, 'a0'),
      tagIds,
    };
  } catch {
    return undefined;
  }
}

function parseStoredFolder(value: unknown): VaultFolder | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return undefined;
  }
  try {
    return {
      id: parseId<FolderId>(value.id),
      name: readString(value.name, 'Folder'),
      parentId: typeof value.parentId === 'string' ? parseId<FolderId>(value.parentId) : null,
      manualPosition: readString(value.manualPosition, 'a0'),
      createdMs: readNumber(value.createdMs, 0),
      modifiedMs: readNumber(value.modifiedMs, 0),
    };
  } catch {
    return undefined;
  }
}

function parseStoredTag(value: unknown): VaultTag | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return undefined;
  }
  try {
    return { id: parseId<TagId>(value.id), name: value.name };
  } catch {
    return undefined;
  }
}

export class MemoryVault {
  notes: VaultNote[] = [];
  folders: VaultFolder[] = [];
  tags: VaultTag[] = [];
  documents = new Map<string, Document>();

  snapshot(): VaultSnapshot {
    const documents: Record<string, Document> = {};
    for (const [id, document] of this.documents) {
      documents[id] = document;
    }
    return {
      notes: this.notes,
      folders: this.folders,
      tags: this.tags,
      documents,
    };
  }

  async hydrate(): Promise<void> {
    const raw = await readJsonFile(VAULT_FILE);
    if (!isRecord(raw)) {
      return;
    }
    const notes = Array.isArray(raw.notes) ? raw.notes : [];
    const folders = Array.isArray(raw.folders) ? raw.folders : [];
    const tags = Array.isArray(raw.tags) ? raw.tags : [];
    this.notes = notes.map(parseStoredNote).filter((note): note is VaultNote => note !== undefined);
    this.folders = folders
      .map(parseStoredFolder)
      .filter((folder): folder is VaultFolder => folder !== undefined);
    this.tags = tags.map(parseStoredTag).filter((tag): tag is VaultTag => tag !== undefined);
    this.documents = new Map();
    if (isRecord(raw.documents)) {
      for (const [id, document] of Object.entries(raw.documents)) {
        try {
          this.documents.set(id, parseDocument(document));
        } catch {
          try {
            this.documents.set(id, emptyDocument(parseId(id)));
          } catch {
            this.documents.set(id, emptyDocument());
          }
        }
      }
    }
  }

  async persist(): Promise<void> {
    const snapshot = this.snapshot();
    const payload: SerializedVault = {
      notes: snapshot.notes,
      folders: snapshot.folders,
      tags: snapshot.tags,
      documents: snapshot.documents,
    };
    await writeJsonFile(VAULT_FILE, payload);
  }

  nextManualPosition(kind: 'note' | 'folder'): string {
    const count = kind === 'note' ? this.notes.length : this.folders.length;
    return `a${String(count).padStart(6, '0')}`;
  }

  createNote(folderId: FolderId | null, clock: DeviceClockState): { noteId: NoteId; clock: DeviceClockState } {
    const ticked = tickClock(clock);
    const noteId = createId<NoteId>();
    const document = emptyDocument(noteId);
    const note: VaultNote = {
      id: noteId,
      title: '',
      folderId,
      pinned: false,
      archived: false,
      trashed: false,
      plainBody: '',
      createdMs: ticked.clock.wallMs,
      modifiedMs: ticked.clock.wallMs,
      manualPosition: this.nextManualPosition('note'),
      tagIds: [],
    };
    this.notes = [note, ...this.notes];
    this.documents.set(noteId, document);
    return { noteId, clock: ticked.next };
  }

  putDocument(noteId: NoteId, document: Document, clock: DeviceClockState): DeviceClockState {
    const ticked = tickClock(clock);
    this.documents.set(noteId, document);
    this.notes = this.notes.map((note) => {
      if (note.id !== noteId) {
        return note;
      }
      return {
        ...note,
        title: titleFromDocument(document, note.title),
        plainBody: plainBodyFromDocument(document),
        modifiedMs: ticked.clock.wallMs,
      };
    });
    return ticked.next;
  }

  getDocument(noteId: NoteId): Document | null {
    return this.documents.get(noteId) ?? null;
  }

  applyNoteCommand(command: NoteCommand, clock: DeviceClockState): DeviceClockState {
    const ticked = tickClock(clock);
    this.notes = this.notes.map((note) => {
      if (note.id !== command.noteId) {
        return note;
      }
      // Only renaming changes the edited time the list shows; the rest is organization.
      switch (command.type) {
        case 'renameTitle':
          return { ...note, title: command.title, modifiedMs: ticked.clock.wallMs };
        case 'pin':
          return { ...note, pinned: command.pinned };
        case 'archive':
          return {
            ...note,
            archived: command.archived,
            trashed: command.archived ? false : note.trashed,
          };
        case 'trash':
          return { ...note, trashed: true, archived: false };
        case 'restore':
          return { ...note, trashed: false, archived: false };
        case 'move':
          return { ...note, folderId: command.folderId };
        case 'tag': {
          const has = note.tagIds.includes(command.tagId);
          const tagIds =
            command.op === 'add'
              ? has
                ? note.tagIds
                : [...note.tagIds, command.tagId]
              : note.tagIds.filter((id) => id !== command.tagId);
          return { ...note, tagIds };
        }
        case 'create':
          return note;
      }
    });
    return ticked.next;
  }

  createFolder(
    name: string,
    parentId: FolderId | null,
    clock: DeviceClockState,
  ): { folderId: FolderId; clock: DeviceClockState } {
    const ticked = tickClock(clock);
    const folderId = createId<FolderId>();
    const folder: VaultFolder = {
      id: folderId,
      name: name.trim(),
      parentId,
      manualPosition: this.nextManualPosition('folder'),
      createdMs: ticked.clock.wallMs,
      modifiedMs: ticked.clock.wallMs,
    };
    this.folders = [...this.folders, folder];
    return { folderId, clock: ticked.next };
  }

  renameFolder(folderId: FolderId, name: string, clock: DeviceClockState): DeviceClockState {
    const ticked = tickClock(clock);
    this.folders = this.folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, name: name.trim(), modifiedMs: ticked.clock.wallMs }
        : folder,
    );
    return ticked.next;
  }

  moveFolder(folderId: FolderId, parentId: FolderId | null, clock: DeviceClockState): DeviceClockState {
    const ticked = tickClock(clock);
    this.folders = this.folders.map((folder) =>
      folder.id === folderId ? { ...folder, parentId, modifiedMs: ticked.clock.wallMs } : folder,
    );
    return ticked.next;
  }

  ensureTag(name: string): VaultTag {
    const trimmed = name.trim();
    const existing = this.tags.find((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());
    if (existing !== undefined) {
      return existing;
    }
    const tag: VaultTag = { id: createId<TagId>(), name: trimmed };
    this.tags = [...this.tags, tag];
    return tag;
  }

  replaceFromStore(snapshot: {
    readonly notes?: readonly VaultNote[];
    readonly folders?: readonly VaultFolder[];
    readonly tags?: readonly VaultTag[];
  }): void {
    if (snapshot.notes !== undefined) {
      this.notes = [...snapshot.notes];
    }
    if (snapshot.folders !== undefined) {
      this.folders = [...snapshot.folders];
    }
    if (snapshot.tags !== undefined) {
      this.tags = [...snapshot.tags];
    }
  }
}
