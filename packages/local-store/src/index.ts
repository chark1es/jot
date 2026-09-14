export type { LocalStore } from './store.js';
export { createSqliteLocalStore } from './sqlite-store.js';
export { NotImplementedError, NotImplementedLocalStore } from './not-implemented.js';
export {
  LOCAL_STORE_TABLE_GROUPS,
  TRASH_RETENTION_MS,
  UNDO_HISTORY_LIMIT,
  systemClock,
} from './types.js';
export type { HistoryEntry, HistoryStep, NoteHistory } from './types.js';
export { selectAutomaticVersionTier } from './versions.js';
export { FTS_TOKENIZE_ATTEMPTS, SCHEMA_SQL } from './sql.js';
export { createStatementDriver } from './driver.js';
export type { SqliteDriver, SqlRow, SqlValue } from './driver.js';
export type {
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
  LocalStoreOptions,
  LocalStoreTableGroup,
  NoteCommand,
  NoteDocument,
  NoteListItem,
  NoteProjection,
  NoteSort,
  OutboxItem,
  RestoreVersionResult,
  SearchHit,
  SearchQuery,
  SearchResult,
  StoreClock,
  StoredOperation,
  StoredUndoEntry,
  UndoEntry,
  UndoRedoList,
  VaultAttachmentExport,
  VaultNoteExport,
  VaultSnapshot,
  VersionSnapshot,
  VersionTier,
} from './types.js';
