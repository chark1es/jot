import type {
  AttachmentId,
  DeviceId,
  Document,
  Folder,
  FolderId,
  NoteId,
  SchemaOperation,
  Tag,
  TagId,
  TransactionId,
} from '@jot/schema';

/**
 * SQLite table groups from design 3.4, used as migration inventory later.
 */
export const LOCAL_STORE_TABLE_GROUPS = [
  'notes',
  'folders',
  'tags',
  'note_tags',
  'documents',
  'crdt_checkpoints',
  'crdt_updates',
  'attachments',
  'editor_intake',
  'applied_transactions',
  'undo_entries',
  'version_snapshots',
  'outbox',
  'remote_objects',
  'remote_heads',
  'sync_cursors',
  'notes_fts',
  'quarantine',
  'migration_log',
  'diagnostic_log',
] as const;

export type LocalStoreTableGroup = (typeof LOCAL_STORE_TABLE_GROUPS)[number];

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Wall clock injected into LocalStore. Structurally compatible with @jot/core Clock
 * and @jot/test-kit FakeClock. Wall time is display and retention only.
 */
export type StoreClock = {
  wallNow(): { readonly unixMs: number };
};

export const systemClock: StoreClock = {
  wallNow: () => ({ unixMs: Date.now() }),
};

export type LocalStoreOptions = {
  readonly clock?: StoreClock;
  readonly attachmentsDir?: string;
};

export type NoteProjection = {
  readonly noteId: NoteId;
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly plainBody: string;
};

export type NoteDocument = {
  readonly document: Document;
  readonly title: string;
};

export type NoteSort = 'created' | 'modified' | 'title' | 'manual';

export type ListNotesQuery = {
  readonly folderId?: FolderId | null;
  readonly archived?: boolean;
  readonly trash?: 'active' | 'trashed' | 'all';
  readonly sort?: NoteSort;
};

export type NoteListItem = {
  readonly noteId: NoteId;
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly trashedAtWallMs: number | null;
  readonly purgeAfterWallMs: number | null;
  readonly createdWallMs: number;
  readonly modifiedWallMs: number;
  readonly manualPosition: string;
};

export type CreateNoteInput = {
  readonly noteId?: NoteId;
  readonly folderId?: FolderId | null;
  readonly title?: string;
};

export type NoteCommand =
  | { readonly type: 'create'; readonly noteId: NoteId; readonly folderId: FolderId | null }
  | { readonly type: 'renameTitle'; readonly noteId: NoteId; readonly title: string }
  | { readonly type: 'pin'; readonly noteId: NoteId; readonly pinned: boolean }
  | { readonly type: 'archive'; readonly noteId: NoteId; readonly archived: boolean }
  | { readonly type: 'trash'; readonly noteId: NoteId }
  | { readonly type: 'restore'; readonly noteId: NoteId }
  | { readonly type: 'move'; readonly noteId: NoteId; readonly folderId: FolderId | null }
  | {
      readonly type: 'tag';
      readonly noteId: NoteId;
      readonly tagId: TagId;
      readonly op: 'add' | 'remove';
    };

export type CreateFolderInput = {
  readonly folderId?: FolderId;
  readonly name: string;
  readonly parentPlacement?: FolderId | null;
  readonly manualPosition?: string;
};

export type FolderCycleRepairEvent = {
  readonly rule: 'remove-newest-parent-edge';
  readonly childId: FolderId;
  readonly parentId: FolderId;
};

export type CreateTagInput = {
  readonly tagId?: TagId;
  readonly name: string;
  readonly colorRole?: string | null;
};

export type UndoEntry = {
  readonly transactionId: TransactionId;
  readonly noteId: NoteId;
  readonly inverse: Uint8Array;
};

export type StoredUndoEntry = UndoEntry & {
  readonly stack: 'undo' | 'redo';
  readonly createdWallMs: number;
};

export type UndoRedoList = {
  readonly undo: readonly StoredUndoEntry[];
  readonly redo: readonly StoredUndoEntry[];
};

export type OutboxItem = {
  readonly transactionId: TransactionId;
  readonly noteId: NoteId;
  readonly payload: Uint8Array;
};

/**
 * Schema-term operations stored with a Committed edit.
 */
export type StoredOperation = SchemaOperation;

export type CommitEditInput = {
  readonly transactionId: TransactionId;
  readonly noteId: NoteId;
  readonly operations: readonly StoredOperation[];
  readonly crdtUpdate: Uint8Array;
  readonly projection: NoteProjection;
  readonly undo: UndoEntry;
  readonly outbox: OutboxItem;
  readonly document: Document;
  readonly restoredFrom?: TransactionId;
};

export type SearchQuery = {
  readonly text: string;
  readonly limit: number;
};

export type SearchHit = {
  readonly noteId: NoteId;
  /**
   * Escaped plain text from FTS5 highlight/snippet.
   * Render as text. Never HTML.
   */
  readonly snippet: string;
};

export type SearchResult = {
  readonly hits: readonly SearchHit[];
  readonly snippets: readonly string[];
};

export type IntakeRecord = {
  readonly transactionId: TransactionId;
  readonly noteId: NoteId;
  readonly operations: readonly StoredOperation[];
};

export type VersionTier = 'hourly' | 'daily' | 'weekly' | 'manual';

export type VersionSnapshot = {
  readonly id: TransactionId;
  readonly noteId: NoteId;
  readonly title: string;
  readonly document: Document;
  readonly label: string | null;
  readonly tier: VersionTier;
  readonly createdWallMs: number;
};

export type RestoreVersionResult = {
  readonly document: Document;
  readonly title: string;
};

export type ImportAttachmentInput = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly originalName: string;
  readonly pixelSize?: { readonly width: number; readonly height: number };
  readonly noteId?: NoteId;
};

export type AttachmentRecord = {
  readonly id: AttachmentId;
  readonly plaintextSha256: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly originalName: string;
  readonly pixelWidth: number | null;
  readonly pixelHeight: number | null;
  readonly localState: 'available' | 'evicted' | 'importing' | 'corrupt' | 'absent';
  readonly localPath: string | null;
  readonly createdWallMs: number;
};

export type DiagnosticEntry = {
  readonly eventType: string;
  readonly entityKind?: string;
  readonly entityId?: string;
  readonly detailCode?: string;
  readonly wallMs: number;
};

export type VaultNoteExport = {
  readonly id: NoteId;
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly tags: readonly TagId[];
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashedAtWallMs: number | null;
  readonly canonicalJson: string;
};

export type VaultAttachmentExport = {
  readonly id: AttachmentId;
  readonly mimeType: string;
  readonly originalName: string;
  readonly byteLength: number;
  readonly plaintextSha256: string;
  readonly localPath: string | null;
  readonly bytes: Uint8Array | null;
};

export type VaultSnapshot = {
  readonly deviceId: DeviceId;
  readonly notes: readonly VaultNoteExport[];
  readonly folders: readonly Folder[];
  readonly tags: readonly Tag[];
  readonly attachments: readonly VaultAttachmentExport[];
};
