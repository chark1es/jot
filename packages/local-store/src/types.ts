import type { FolderId, NoteId, SchemaOperation, TransactionId } from '@jolt/schema';

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

export type NoteProjection = {
  readonly noteId: NoteId;
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly plainBody: string;
};

export type UndoEntry = {
  readonly transactionId: TransactionId;
  readonly noteId: NoteId;
  readonly inverse: Uint8Array;
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
