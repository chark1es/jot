import { createExpoLocalStore } from '@jot/local-store-expo';
import { UNDO_HISTORY_LIMIT } from '@jot/local-store';
import type {
  CommitEditInput,
  DiagnosticEntry,
  HistoryStep,
  LocalStore,
  NoteHistory,
  NoteListItem,
  SearchQuery,
  SearchResult,
  VaultSnapshot as StoreSnapshot,
  VersionSnapshot,
} from '@jot/local-store';
import type { NoteCommand } from '@jot/core';
import { createId, parseDocument } from '@jot/schema';
import type {
  AttachmentId,
  ClockEvent,
  DeviceId,
  Document,
  Folder,
  FolderId,
  NoteId,
  SchemaNode,
  TagId,
  TransactionId,
} from '@jot/schema';
import { invertOperations } from '@jot/editor-native';
import type { ExportAttachment, ExportFolder, ExportNote, VaultExportInput } from '@jot/import-export';
import {
  attachmentsDirectoryUri,
  fileExists,
  readFileBytes,
  removeAttachmentFilesExcept,
  writeAttachmentFile,
} from './attachments';
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

export type CommitRequest = {
  readonly noteId: NoteId;
  readonly transactionId: TransactionId;
  readonly operations: CommitEditInput['operations'];
  readonly crdtUpdate: Uint8Array;
  readonly document: Document;
  readonly baseDocument: Document;
  readonly history?: HistoryStep;
};

export type ImageAsset = {
  readonly uri: string;
  readonly mimeType?: string | null;
  readonly fileName?: string | null;
  readonly width?: number;
  readonly height?: number;
};

export type ImportedImage = {
  readonly attachmentId: AttachmentId;
  readonly path: string;
};

const EMPTY_HISTORY: NoteHistory = { undo: [], redo: [] };
/** Automatic versions are checked at most this often per note while someone types. */
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TITLE_LIMIT = 120;

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

function noteTitle(document: Document): string {
  return titleFromDocument(document, '').slice(0, TITLE_LIMIT);
}

function mimeTypeFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const known: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return known[extension] ?? 'application/octet-stream';
}

function attachmentIdsIn(node: SchemaNode, into: Set<string>): Set<string> {
  if (node.type === 'image' || node.type === 'fileAttachment') {
    const id = node.attrs.attachmentId;
    if (typeof id === 'string') {
      into.add(id);
    }
  }
  for (const child of node.content) {
    attachmentIdsIn(child, into);
  }
  return into;
}

function fromListItem(item: NoteListItem): VaultNote {
  return {
    id: item.noteId,
    title: item.title,
    folderId: item.folderId,
    pinned: item.pinned,
    archived: item.archived,
    trashed: item.trashed,
    plainBody: item.snippet,
    createdMs: item.createdWallMs,
    modifiedMs: item.modifiedWallMs,
    manualPosition: item.manualPosition,
    tagIds: item.tagIds,
  };
}

function fromFolder(folder: Folder): VaultFolder {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentPlacement,
    manualPosition: folder.manualPosition,
    createdMs: folder.created.wallMs,
    modifiedMs: folder.modified.wallMs,
  };
}

export class VaultSession {
  private readonly versionChecks = new Map<string, number>();

  private constructor(
    readonly store: LocalStore | null,
    readonly memory: MemoryVault,
    private clock: DeviceClockState,
    readonly usingMemoryFallback: boolean,
    readonly attachmentsDirectory: string | null,
  ) {}

  static async open(): Promise<VaultSession> {
    const clock = await loadDeviceClock();
    const memory = new MemoryVault();
    await memory.hydrate();

    let store: LocalStore | null = null;
    try {
      store = createExpoLocalStore();
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

    const session = new VaultSession(store, memory, clock, store === null, await attachmentsDirectoryUri());
    if (store !== null) {
      try {
        // Trash keeps notes for 30 days. Checking at launch is enough for a local-only app.
        const purged = await store.purgeExpiredTrash();
        if (purged.length > 0) {
          await session.removeOrphanAttachmentFiles();
        }
      } catch {
        // The purge runs again at the next launch.
      }
    }
    await session.refreshFromStore();
    return session;
  }

  get deviceId(): string {
    return this.clock.deviceId;
  }

  snapshot(): VaultSnapshot {
    return this.memory.snapshot();
  }

  private async persistMemory(): Promise<void> {
    await this.memory.persist();
    await persistDeviceClock(this.clock);
  }

  async refreshFromStore(): Promise<void> {
    const store = this.store;
    if (store === null) {
      return;
    }
    const notes = await tryStore(() => store.listNotes({ trash: 'all', archived: 'any' }));
    const folders = await tryStore(() => store.listFolders());
    const tags = await tryStore(() => store.listTags());
    this.memory.replaceFromStore({
      ...(notes.ok ? { notes: notes.value.map(fromListItem) } : {}),
      ...(folders.ok ? { folders: folders.value.map(fromFolder) } : {}),
      ...(tags.ok ? { tags: tags.value.map((tag) => ({ id: tag.id, name: tag.name })) } : {}),
    });
  }

  async createNote(folderId: FolderId | null): Promise<NoteId> {
    const store = this.store;
    if (store !== null) {
      const created = await tryStore(() => store.createNote({ folderId }));
      if (created.ok) {
        await this.refreshFromStore();
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
        await this.restoreAttachmentFiles(noteId);
        return loaded.value.document;
      }
    }
    return this.memory.getDocument(noteId) ?? emptyDocument(noteId);
  }

  async commitEdit(input: CommitRequest): Promise<void> {
    const title = noteTitle(input.document);
    this.clock = this.memory.putDocument(input.noteId, input.document, this.clock);
    this.memory.notes = this.memory.notes.map((entry) => (entry.id === input.noteId ? { ...entry, title } : entry));
    const note = this.memory.notes.find((entry) => entry.id === input.noteId);
    const inverse = invertOperations(input.baseDocument, input.operations);
    const payload: CommitEditInput = {
      transactionId: input.transactionId,
      noteId: input.noteId,
      operations: input.operations,
      crdtUpdate: input.crdtUpdate,
      document: input.document,
      projection: {
        noteId: input.noteId,
        title,
        folderId: note?.folderId ?? null,
        pinned: note?.pinned ?? false,
        archived: note?.archived ?? false,
        trashed: note?.trashed ?? false,
        plainBody: plainBodyFromDocument(input.document),
      },
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
      ...(input.history === undefined ? {} : { history: input.history }),
    };
    const store = this.store;
    if (store !== null) {
      const committed = await tryStore(() => store.commitEdit(payload));
      if (committed.ok) {
        await this.considerVersion(input.noteId);
        return;
      }
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
        return;
      }
    }
    await this.persistMemory();
  }

  async reorderNotes(ordered: readonly NoteId[]): Promise<void> {
    // Positions are rewritten for the whole visible list so string order always matches it.
    const positions = new Map(ordered.map((id, index) => [id, `m${String(index).padStart(6, '0')}`]));
    const store = this.store;
    if (store !== null) {
      for (const [id, position] of positions) {
        await tryStore(() => store.reorderNote(id, position));
      }
    }
    this.memory.notes = this.memory.notes.map((note) => {
      const position = positions.get(note.id);
      return position === undefined ? note : { ...note, manualPosition: position };
    });
    if (store !== null) {
      await this.refreshFromStore();
    } else {
      await this.persistMemory();
    }
  }

  async deleteNotePermanently(noteId: NoteId): Promise<void> {
    const store = this.store;
    if (store !== null) {
      const removed = await tryStore(() => store.deleteNotePermanently(noteId));
      if (removed.ok) {
        await this.refreshFromStore();
        await this.removeOrphanAttachmentFiles();
        return;
      }
    }
    this.memory.notes = this.memory.notes.filter((note) => note.id !== noteId);
    this.memory.documents.delete(noteId);
    await this.persistMemory();
  }

  async emptyTrash(): Promise<number> {
    const trashed = this.memory.notes.filter((note) => note.trashed);
    for (const note of trashed) {
      await this.deleteNotePermanently(note.id);
    }
    return trashed.length;
  }

  async createTag(name: string): Promise<VaultTag> {
    const trimmed = name.normalize('NFC').trim();
    if (trimmed.length === 0) {
      throw new Error('Tag names cannot be empty.');
    }
    const existing = this.memory.tags.find((tag) => tag.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (existing !== undefined) {
      return existing;
    }
    const store = this.store;
    if (store !== null) {
      const created = await tryStore(() => store.createTag({ name: trimmed }));
      if (created.ok) {
        await this.refreshFromStore();
        return { id: created.value, name: trimmed };
      }
    }
    const tag = this.memory.ensureTag(trimmed);
    await this.persistMemory();
    return tag;
  }

  async setNoteTag(noteId: NoteId, tagId: TagId, attached: boolean): Promise<void> {
    await this.applyNoteCommand({ type: 'tag', noteId, tagId, op: attached ? 'add' : 'remove' });
  }

  async listHistory(noteId: NoteId): Promise<NoteHistory> {
    const store = this.store;
    if (store === null) {
      return EMPTY_HISTORY;
    }
    const history = await tryStore(() => store.listHistory(noteId, UNDO_HISTORY_LIMIT));
    return history.ok ? history.value : EMPTY_HISTORY;
  }

  async listAppliedTransactionIds(noteId: NoteId): Promise<readonly TransactionId[]> {
    const store = this.store;
    if (store === null) {
      return [];
    }
    const applied = await tryStore(() => store.listAppliedTransactionIds(noteId, 500));
    return applied.ok ? applied.value : [];
  }

  async listVersions(noteId: NoteId): Promise<readonly VersionSnapshot[]> {
    const store = this.store;
    if (store === null) {
      return [];
    }
    const versions = await tryStore(() => store.listVersions(noteId));
    return versions.ok ? versions.value : [];
  }

  async saveVersion(noteId: NoteId): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('Versions need the local database, which did not open on this device.');
    }
    await store.saveVersion(noteId, { tier: 'manual' });
  }

  async versionDocument(noteId: NoteId, versionId: TransactionId): Promise<Document> {
    const store = this.store;
    if (store === null) {
      throw new Error('Versions need the local database, which did not open on this device.');
    }
    return (await store.restoreVersion(noteId, versionId)).document;
  }

  async importImage(noteId: NoteId, asset: ImageAsset): Promise<ImportedImage> {
    const directory = this.attachmentsDirectory;
    if (directory === null) {
      throw new Error('Jot could not find its attachments folder on this device.');
    }
    const bytes = await readFileBytes(asset.uri);
    if (bytes.byteLength === 0) {
      throw new Error('That image is empty.');
    }
    const originalName = asset.fileName ?? asset.uri.split('/').pop() ?? 'image';
    const mimeType = asset.mimeType ?? mimeTypeFor(originalName);
    let attachmentId = createId<AttachmentId>();
    const store = this.store;
    if (store !== null) {
      const pixelSize =
        asset.width !== undefined && asset.height !== undefined && asset.width > 0 && asset.height > 0
          ? { pixelSize: { width: asset.width, height: asset.height } }
          : {};
      const imported = await tryStore(() =>
        store.importAttachment({ bytes, mimeType, originalName, noteId, ...pixelSize }),
      );
      if (imported.ok) {
        attachmentId = imported.value.id;
      }
    }
    return { attachmentId, path: writeAttachmentFile(directory, attachmentId, bytes) };
  }

  async listDiagnostics(limit: number): Promise<readonly DiagnosticEntry[]> {
    const store = this.store;
    if (store === null) {
      return [];
    }
    const entries = await tryStore(() => store.listDiagnostics(limit));
    return entries.ok ? entries.value : [];
  }

  async createFolder(name: string, parentId: FolderId | null): Promise<FolderId> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Folder names cannot be empty.');
    }
    const store = this.store;
    if (store !== null) {
      const created = await tryStore(() => store.createFolder({ name: trimmed, parentPlacement: parentId }));
      if (created.ok) {
        await this.refreshFromStore();
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
      throw new Error('Folder names cannot be empty.');
    }
    const store = this.store;
    if (store !== null) {
      const renamed = await tryStore(() => store.renameFolder(folderId, trimmed));
      if (renamed.ok) {
        await this.refreshFromStore();
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
        return;
      }
    }
    this.clock = this.memory.moveFolder(folderId, parentId, this.clock);
    await this.persistMemory();
  }

  /** Trashes a folder and its subfolders. Their notes move to No folder instead of disappearing. */
  async deleteFolder(folderId: FolderId): Promise<void> {
    const doomed = new Set<string>([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of this.memory.folders) {
        if (folder.parentId !== null && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          grew = true;
        }
      }
    }
    for (const note of this.memory.notes.filter((entry) => entry.folderId !== null && doomed.has(entry.folderId))) {
      await this.applyNoteCommand({ type: 'move', noteId: note.id, folderId: null });
    }
    const store = this.store;
    if (store !== null) {
      let trashed = true;
      for (const id of doomed) {
        const result = await tryStore(() => store.trashFolder(id as FolderId));
        trashed = trashed && result.ok;
      }
      if (trashed) {
        await this.refreshFromStore();
        return;
      }
    }
    this.memory.folders = this.memory.folders.filter((folder) => !doomed.has(folder.id));
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
        return this.storeSnapshotToExport(snapshot.value);
      }
    }
    return this.memoryToExportInput();
  }

  private storeSnapshotToExport(snapshot: StoreSnapshot): VaultExportInput {
    const attachments = new Map(snapshot.attachments.map((record) => [record.id, record]));
    const listed = new Map(this.memory.notes.map((note) => [note.id, note]));
    const now = Date.now();
    const notes: ExportNote[] = snapshot.notes.map((note, index) => {
      const document = parseCanonical(note.canonicalJson);
      const summary = listed.get(note.id);
      const noteAttachments: ExportAttachment[] = [...attachmentIdsIn(document, new Set())].flatMap((id) => {
        const record = attachments.get(id as AttachmentId);
        if (record?.bytes === null || record?.bytes === undefined) {
          return [];
        }
        return [{ id: record.id, originalName: record.originalName, mimeType: record.mimeType, bytes: record.bytes }];
      });
      return {
        id: note.id,
        title: note.title.trim() === '' ? 'New note' : note.title,
        document,
        folderPlacement: note.folderId,
        tags: note.tags.map((tagId) => {
          const tag = snapshot.tags.find((entry) => entry.id === tagId);
          return { id: tagId, name: tag?.name ?? tagId };
        }),
        pinned: note.pinned,
        archived: note.archived,
        created: clockEvent(snapshot.deviceId, summary?.createdMs ?? now, index + 1),
        modified: clockEvent(snapshot.deviceId, summary?.modifiedMs ?? now, index + 1),
        attachments: noteAttachments,
      };
    });
    const folders: ExportFolder[] = snapshot.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentPlacement: folder.parentPlacement,
      manualPosition: folder.manualPosition,
    }));
    return { notes, folders };
  }

  private memoryToExportInput(): VaultExportInput {
    const snapshot = this.memory.snapshot();
    const notes: ExportNote[] = snapshot.notes.map((note, index) => {
      const created = clockEvent(this.clock.deviceId, note.createdMs, index + 1);
      const modified = clockEvent(this.clock.deviceId, note.modifiedMs, index + 1);
      return {
        id: note.id,
        title: note.title.trim() === '' ? 'New note' : note.title,
        document: snapshot.documents[note.id] ?? emptyDocument(note.id),
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

  private async considerVersion(noteId: NoteId): Promise<void> {
    const store = this.store;
    const now = Date.now();
    if (store === null || now - (this.versionChecks.get(noteId) ?? 0) < VERSION_CHECK_INTERVAL_MS) {
      return;
    }
    this.versionChecks.set(noteId, now);
    try {
      await store.considerAutomaticVersion(noteId);
    } catch {
      // A missed automatic version is retried on the next check.
    }
  }

  /** Rewrites attachment files from SQLite when the files are gone, such as after a restore. */
  private async restoreAttachmentFiles(noteId: NoteId): Promise<void> {
    const store = this.store;
    const directory = this.attachmentsDirectory;
    if (store === null || directory === null) {
      return;
    }
    const records = await tryStore(() => store.listAttachments(noteId));
    if (!records.ok) {
      return;
    }
    for (const record of records.value) {
      if (await fileExists(`${directory}${record.id}`)) {
        continue;
      }
      const bytes = await store.getAttachmentBytes(record.id);
      if (bytes !== null) {
        writeAttachmentFile(directory, record.id, bytes);
      }
    }
  }

  private async removeOrphanAttachmentFiles(): Promise<void> {
    const store = this.store;
    const directory = this.attachmentsDirectory;
    if (store === null || directory === null) {
      return;
    }
    const records = await tryStore(() => store.listAttachments());
    if (records.ok) {
      await removeAttachmentFilesExcept(directory, new Set(records.value.map((record) => record.id)));
    }
  }
}
