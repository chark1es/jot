import type { AttachmentId, DeviceId, Folder, FolderId, NoteId, Tag, TagId, TransactionId } from '@jot/schema';
import type {
  AttachmentRecord,
  CommitEditInput,
  CreateFolderInput,
  CreateNoteInput,
  CreateTagInput,
  DiagnosticEntry,
  FolderCycleRepairEvent,
  ImportAttachmentInput,
  IntakeRecord,
  ListNotesQuery,
  NoteCommand,
  NoteDocument,
  NoteListItem,
  NoteProjection,
  RestoreVersionResult,
  SearchQuery,
  SearchResult,
  UndoRedoList,
  VaultSnapshot,
  VersionSnapshot,
  VersionTier,
} from './types.js';

/**
 * Platform-neutral local durability module.
 *
 * Runs SQLite in WAL mode on every target. `local-store-expo` uses expo-sqlite;
 * `local-store-tauri` uses Rust SQLite. This package owns the interface, SQL,
 * and the bun:sqlite implementation used by contract tests (`@jot/local-store/bun`).
 *
 * A write transaction stores the CRDT update or Checkpoint, normalized Note
 * projection, Attachment references, undo metadata, and sync outbox row.
 *
 * Search uses an external-content FTS5 table over title, plain body, Tag names,
 * and image captions. Snippets are escaped text, never HTML.
 *
 * Every Committed edit first enters the editor_intake journal. The materializer
 * applies it to the CRDT, then commits projection, undo, and outbox together
 * and marks the intake record applied. `replayUnappliedIntake` recovers after crash.
 */
export interface LocalStore {
  open(): Promise<void>;
  close(): Promise<void>;
  getDeviceId(): Promise<DeviceId>;

  commitEdit(input: CommitEditInput): Promise<void>;
  getNoteProjection(noteId: NoteId): Promise<NoteProjection | null>;
  replayUnappliedIntake(): Promise<readonly IntakeRecord[]>;
  search(query: SearchQuery): Promise<SearchResult>;

  createNote(input?: CreateNoteInput): Promise<NoteId>;
  listNotes(query?: ListNotesQuery): Promise<readonly NoteListItem[]>;
  getNoteDocument(noteId: NoteId): Promise<NoteDocument | null>;
  applyNoteCommand(command: NoteCommand): Promise<void>;
  pinNote(noteId: NoteId, pinned: boolean): Promise<void>;
  archiveNote(noteId: NoteId, archived: boolean): Promise<void>;
  trashNote(noteId: NoteId): Promise<void>;
  restoreNote(noteId: NoteId): Promise<void>;
  moveNote(noteId: NoteId, folderId: FolderId | null): Promise<void>;
  renameTitle(noteId: NoteId, title: string): Promise<void>;

  createFolder(input: CreateFolderInput): Promise<FolderId>;
  listFolders(): Promise<readonly Folder[]>;
  renameFolder(folderId: FolderId, name: string): Promise<void>;
  moveFolder(folderId: FolderId, parentPlacement: FolderId | null): Promise<FolderCycleRepairEvent | null>;
  trashFolder(folderId: FolderId): Promise<void>;
  restoreFolder(folderId: FolderId): Promise<void>;
  reorderFolder(folderId: FolderId, manualPosition: string): Promise<void>;

  createTag(input: CreateTagInput): Promise<TagId>;
  listTags(): Promise<readonly Tag[]>;
  addTagToNote(noteId: NoteId, tagId: TagId): Promise<void>;
  removeTagFromNote(noteId: NoteId, tagId: TagId): Promise<void>;

  listUndoRedo(noteId: NoteId, limit: number): Promise<UndoRedoList>;

  saveVersion(
    noteId: NoteId,
    options?: { readonly label?: string; readonly tier?: VersionTier },
  ): Promise<VersionSnapshot>;
  listVersions(noteId: NoteId): Promise<readonly VersionSnapshot[]>;
  restoreVersion(noteId: NoteId, versionId: TransactionId): Promise<RestoreVersionResult>;
  considerAutomaticVersion(noteId: NoteId): Promise<VersionSnapshot | null>;

  importAttachment(input: ImportAttachmentInput): Promise<AttachmentRecord>;
  listAttachments(noteId?: NoteId): Promise<readonly AttachmentRecord[]>;
  getAttachmentBytes(attachmentId: AttachmentId): Promise<Uint8Array | null>;

  appendDiagnostic(entry: DiagnosticEntry): Promise<void>;
  listDiagnostics(limit: number): Promise<readonly DiagnosticEntry[]>;

  getCrdtUpdates(noteId: NoteId): Promise<readonly Uint8Array[]>;
  exportVaultSnapshot(): Promise<VaultSnapshot>;
}
