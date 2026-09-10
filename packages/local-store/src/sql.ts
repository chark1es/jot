export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vault_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_records (
  device_id TEXT PRIMARY KEY NOT NULL,
  created_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  folder_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  trashed INTEGER NOT NULL DEFAULT 0,
  trashed_at_wall_ms INTEGER,
  trashed_logical_counter INTEGER,
  trashed_logical_device TEXT,
  purge_after_wall_ms INTEGER,
  manual_position TEXT NOT NULL,
  created_wall_ms INTEGER NOT NULL,
  created_logical_counter INTEGER NOT NULL,
  created_logical_device TEXT NOT NULL,
  modified_wall_ms INTEGER NOT NULL,
  modified_logical_counter INTEGER NOT NULL,
  modified_logical_device TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  parent_logical_counter INTEGER,
  parent_logical_device TEXT,
  manual_position TEXT NOT NULL,
  created_wall_ms INTEGER NOT NULL,
  created_logical_counter INTEGER NOT NULL,
  created_logical_device TEXT NOT NULL,
  modified_wall_ms INTEGER NOT NULL,
  modified_logical_counter INTEGER NOT NULL,
  modified_logical_device TEXT NOT NULL,
  trashed INTEGER NOT NULL DEFAULT 0,
  trashed_at_wall_ms INTEGER,
  trashed_logical_counter INTEGER,
  trashed_logical_device TEXT,
  purge_after_wall_ms INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color_role TEXT,
  created_wall_ms INTEGER NOT NULL,
  created_logical_counter INTEGER NOT NULL,
  created_logical_device TEXT NOT NULL,
  modified_wall_ms INTEGER NOT NULL,
  modified_logical_counter INTEGER NOT NULL,
  modified_logical_device TEXT NOT NULL,
  trashed INTEGER NOT NULL DEFAULT 0,
  trashed_at_wall_ms INTEGER,
  trashed_logical_counter INTEGER,
  trashed_logical_device TEXT
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS documents (
  note_id TEXT PRIMARY KEY NOT NULL,
  document_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crdt_checkpoints (
  note_id TEXT PRIMARY KEY NOT NULL,
  checkpoint BLOB NOT NULL,
  state_vector BLOB NOT NULL,
  updated_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crdt_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  update_bytes BLOB NOT NULL,
  created_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  pixel_width INTEGER,
  pixel_height INTEGER,
  local_state TEXT NOT NULL,
  local_path TEXT,
  bytes BLOB,
  created_wall_ms INTEGER NOT NULL,
  created_logical_counter INTEGER NOT NULL,
  created_logical_device TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachment_refs (
  note_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  PRIMARY KEY (note_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS local_files (
  attachment_id TEXT PRIMARY KEY NOT NULL,
  abs_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS editor_intake (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  created_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS applied_transactions (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL,
  applied_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL UNIQUE,
  note_id TEXT NOT NULL,
  inverse BLOB NOT NULL,
  created_wall_ms INTEGER NOT NULL,
  stack TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS version_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL,
  title TEXT NOT NULL,
  document_json TEXT NOT NULL,
  label TEXT,
  tier TEXT NOT NULL,
  created_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL,
  payload BLOB NOT NULL,
  created_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_objects (
  object_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_heads (
  device_id TEXT PRIMARY KEY NOT NULL,
  sequence INTEGER NOT NULL,
  head_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  provider TEXT PRIMARY KEY NOT NULL,
  cursor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  object_id TEXT,
  reason TEXT NOT NULL,
  created_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_log (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostic_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_kind TEXT,
  entity_id TEXT,
  detail_code TEXT,
  wall_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes_search_src (
  rowid INTEGER PRIMARY KEY,
  note_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  captions TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notes_folder_idx ON notes(folder_id);
CREATE INDEX IF NOT EXISTS notes_modified_idx ON notes(modified_wall_ms);
CREATE INDEX IF NOT EXISTS notes_created_idx ON notes(created_wall_ms);
CREATE INDEX IF NOT EXISTS undo_note_idx ON undo_entries(note_id, id);
CREATE INDEX IF NOT EXISTS versions_note_idx ON version_snapshots(note_id, created_wall_ms);
CREATE INDEX IF NOT EXISTS crdt_updates_note_idx ON crdt_updates(note_id, id);
`;

export const FTS_TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS notes_search_ai AFTER INSERT ON notes_search_src BEGIN
  INSERT INTO notes_fts(rowid, title, body, tags, captions)
  VALUES (new.rowid, new.title, new.body, new.tags, new.captions);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_ad AFTER DELETE ON notes_search_src BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body, tags, captions)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.captions);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_au AFTER UPDATE ON notes_search_src BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body, tags, captions)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.captions);
  INSERT INTO notes_fts(rowid, title, body, tags, captions)
  VALUES (new.rowid, new.title, new.body, new.tags, new.captions);
END;
`;

/**
 * FTS5 tokenizer attempts. Prefer unicode61 with diacritic removal.
 * If this SQLite build lacks that tokenizer option, fall back and still
 * rank title > tags > body.
 */
export const FTS_TOKENIZE_ATTEMPTS = [
  "tokenize = 'unicode61 remove_diacritics 2'",
  "tokenize = 'unicode61 remove_diacritics 1'",
  "tokenize = 'unicode61'",
] as const;
