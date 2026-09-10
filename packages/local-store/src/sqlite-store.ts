import type {
  AttachmentId,
  DeviceId,
  Document,
  Folder,
  FolderId,
  LogicalTime,
  NoteId,
  SchemaOperation,
  Tag,
  TagId,
  TransactionId,
} from '@jot/schema';
import {
  canonicalizeDocumentToString,
  createId,
  deriveId,
  encodeBase32,
  parseDocument,
  parseId,
  SCHEMA_VERSION,
  validateFolder,
  validateTag,
} from '@jot/schema';
import type { SqliteDriver, SqlRow, SqlValue } from './driver.js';
import {
  asBool,
  asBytes,
  asBytesOrNull,
  asNumber,
  asNumberOrNull,
  asString,
  asStringOrNull,
} from './driver.js';
import {
  captionsFromDocument,
  escapeSnippet,
  ftsMatchQuery,
  plainBodyFromDocument,
} from './document-text.js';
import { newestParentEdgeToRemove, type FolderParentEdge } from './folder-repair.js';
import { FTS_TOKENIZE_ATTEMPTS, FTS_TRIGGERS_SQL, SCHEMA_SQL } from './sql.js';
import type { LocalStore } from './store.js';
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
  LocalStoreOptions,
  NoteCommand,
  NoteDocument,
  NoteListItem,
  NoteProjection,
  RestoreVersionResult,
  SearchQuery,
  SearchResult,
  StoreClock,
  StoredUndoEntry,
  UndoRedoList,
  VaultSnapshot,
  VersionSnapshot,
  VersionTier,
} from './types.js';
import { systemClock, TRASH_RETENTION_MS } from './types.js';
import { selectAutomaticVersionTier } from './versions.js';

/* SQLite drivers used here are synchronous. LocalStore is async for expo-sqlite. */
/* eslint-disable @typescript-eslint/require-await */

const EMPTY_BLOB = new Uint8Array(0);

export function createSqliteLocalStore(
  driver: SqliteDriver,
  options: LocalStoreOptions = {},
): LocalStore {
  return new SqliteLocalStore(driver, options);
}

class SqliteLocalStore implements LocalStore {
  private opened = false;
  private deviceId: DeviceId | undefined;
  private readonly clock: StoreClock;
  private readonly attachmentsDir: string | undefined;

  constructor(
    private readonly driver: SqliteDriver,
    options: LocalStoreOptions,
  ) {
    this.clock = options.clock ?? systemClock;
    if (options.attachmentsDir !== undefined) {
      this.attachmentsDir = options.attachmentsDir;
    }
  }

  async open(): Promise<void> {
    if (this.opened) {
      return;
    }
    this.driver.exec('PRAGMA journal_mode = WAL');
    this.driver.exec('PRAGMA synchronous = FULL');
    this.driver.exec('PRAGMA foreign_keys = ON');
    this.driver.exec(SCHEMA_SQL);
    this.ensureFts();
    this.driver.exec(FTS_TRIGGERS_SQL);
    this.ensureDevice();
    const wallMs = this.clock.wallNow().unixMs;
    this.driver.run('INSERT OR IGNORE INTO migration_log(version, applied_wall_ms) VALUES (1, ?)', [
      wallMs,
    ]);
    this.opened = true;
    this.diagnose({ eventType: 'store_opened', wallMs });
  }

  async close(): Promise<void> {
    this.driver.close();
    this.opened = false;
  }

  async getDeviceId(): Promise<DeviceId> {
    this.requireOpen();
    return this.requireDevice();
  }

  async commitEdit(input: CommitEditInput): Promise<void> {
    this.requireOpen();
    const wallMs = this.clock.wallNow().unixMs;
    this.driver.transaction(() => {
      const existing = this.driver.get(
        'SELECT transaction_id FROM applied_transactions WHERE transaction_id = ?',
        [input.transactionId],
      );
      if (existing !== undefined) {
        return;
      }
      this.driver.run(
        `INSERT OR IGNORE INTO editor_intake(transaction_id, note_id, operations_json, created_wall_ms)
         VALUES (?, ?, ?, ?)`,
        [input.transactionId, input.noteId, JSON.stringify(input.operations), wallMs],
      );
      this.driver.run(
        `INSERT INTO crdt_updates(note_id, transaction_id, update_bytes, created_wall_ms)
         VALUES (?, ?, ?, ?)`,
        [input.noteId, input.transactionId, input.crdtUpdate, wallMs],
      );
      this.driver.run(
        `INSERT INTO crdt_checkpoints(note_id, checkpoint, state_vector, updated_wall_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(note_id) DO UPDATE SET
           checkpoint = excluded.checkpoint,
           updated_wall_ms = excluded.updated_wall_ms`,
        [input.noteId, input.crdtUpdate, EMPTY_BLOB, wallMs],
      );
      this.applyProjection(input.projection, wallMs);
      this.writeDocument(input.noteId, input.document);
      if (input.restoredFrom !== undefined) {
        this.driver.run(
          `UPDATE undo_entries SET stack = 'redo' WHERE transaction_id = ? AND note_id = ?`,
          [input.restoredFrom, input.noteId],
        );
      } else {
        this.driver.run(`DELETE FROM undo_entries WHERE note_id = ? AND stack = 'redo'`, [
          input.noteId,
        ]);
      }
      this.driver.run(
        `INSERT INTO undo_entries(transaction_id, note_id, inverse, created_wall_ms, stack)
         VALUES (?, ?, ?, ?, 'undo')`,
        [input.undo.transactionId, input.noteId, input.undo.inverse, wallMs],
      );
      this.driver.run(
        `INSERT INTO outbox(transaction_id, note_id, payload, created_wall_ms)
         VALUES (?, ?, ?, ?)`,
        [input.outbox.transactionId, input.noteId, input.outbox.payload, wallMs],
      );
      this.driver.run(
        `INSERT INTO applied_transactions(transaction_id, note_id, applied_wall_ms)
         VALUES (?, ?, ?)`,
        [input.transactionId, input.noteId, wallMs],
      );
      this.refreshFts(input.noteId);
      this.diagnose({
        eventType: 'edit_committed',
        entityKind: 'note',
        entityId: input.noteId,
        wallMs,
      });
    });
  }

  async getNoteProjection(noteId: NoteId): Promise<NoteProjection | null> {
    this.requireOpen();
    const row = this.driver.get(
      `SELECT n.id, n.title, n.folder_id, n.pinned, n.archived, n.trashed, d.document_json
       FROM notes n
       LEFT JOIN documents d ON d.note_id = n.id
       WHERE n.id = ?`,
      [noteId],
    );
    if (row === undefined) {
      return null;
    }
    const documentJson = asStringOrNull(row.document_json, 'document_json');
    const document =
      documentJson === null ? null : parseDocument(JSON.parse(documentJson) as unknown);
    return {
      noteId,
      title: asString(row.title, 'title'),
      folderId: parseFolderId(asStringOrNull(row.folder_id, 'folder_id')),
      pinned: asBool(row.pinned, 'pinned'),
      archived: asBool(row.archived, 'archived'),
      trashed: asBool(row.trashed, 'trashed'),
      plainBody: document === null ? '' : plainBodyFromDocument(document),
    };
  }

  async replayUnappliedIntake(): Promise<readonly IntakeRecord[]> {
    this.requireOpen();
    const rows = this.driver.all(
      `SELECT i.transaction_id, i.note_id, i.operations_json
       FROM editor_intake i
       LEFT JOIN applied_transactions a ON a.transaction_id = i.transaction_id
       WHERE a.transaction_id IS NULL
       ORDER BY i.created_wall_ms ASC`,
    );
    return rows.map((row) => ({
      transactionId: parseId<TransactionId>(asString(row.transaction_id, 'transaction_id')),
      noteId: parseId<NoteId>(asString(row.note_id, 'note_id')),
      operations: parseOperations(asString(row.operations_json, 'operations_json')),
    }));
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    this.requireOpen();
    const match = ftsMatchQuery(query.text);
    if (match === null) {
      return { hits: [], snippets: [] };
    }
    const limit = query.limit > 0 ? query.limit : 50;
    let rows: SqlRow[];
    try {
      rows = this.driver.all(
        `SELECT c.note_id AS note_id,
                snippet(notes_fts, 0, '', '', '…', 8) AS title_snip,
                snippet(notes_fts, 1, '', '', '…', 16) AS body_snip
         FROM notes_fts
         JOIN notes_search_src c ON c.rowid = notes_fts.rowid
         JOIN notes n ON n.id = c.note_id
         WHERE notes_fts MATCH ? AND n.trashed = 0
         ORDER BY bm25(notes_fts, 12.0, 1.0, 4.0, 1.5)
         LIMIT ?`,
        [match, limit],
      );
    } catch {
      rows = this.driver.all(
        `SELECT c.note_id AS note_id,
                snippet(notes_fts, 0, '', '', '…', 8) AS title_snip,
                snippet(notes_fts, 1, '', '', '…', 16) AS body_snip
         FROM notes_fts
         JOIN notes_search_src c ON c.rowid = notes_fts.rowid
         JOIN notes n ON n.id = c.note_id
         WHERE notes_fts MATCH ? AND n.trashed = 0
         LIMIT ?`,
        [match, limit],
      );
    }
    const hits = rows.map((row) => {
      const titleSnip = asStringOrNull(row.title_snip, 'title_snip') ?? '';
      const bodySnip = asStringOrNull(row.body_snip, 'body_snip') ?? '';
      const raw = titleSnip.trim().length > 0 && titleSnip !== '…' ? titleSnip : bodySnip;
      const snippet = escapeSnippet(raw);
      return {
        noteId: parseId<NoteId>(asString(row.note_id, 'note_id')),
        snippet,
      };
    });
    return { hits, snippets: hits.map((hit) => hit.snippet) };
  }

  async createNote(input: CreateNoteInput = {}): Promise<NoteId> {
    this.requireOpen();
    const noteId = input.noteId ?? createId<NoteId>();
    const title = input.title ?? '';
    const folderId = Object.hasOwn(input, 'folderId') ? (input.folderId ?? null) : null;
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    const document = emptyDocument(noteId);
    this.driver.transaction(() => {
      this.driver.run(
        `INSERT INTO notes(
           id, schema_version, title, folder_id, pinned, archived, trashed,
           manual_position, created_wall_ms, created_logical_counter, created_logical_device,
           modified_wall_ms, modified_logical_counter, modified_logical_device
         ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
        [
          noteId,
          SCHEMA_VERSION,
          title,
          folderId,
          `a${String(logical.counter)}`,
          wallMs,
          logical.counter,
          logical.deviceId,
          wallMs,
          logical.counter,
          logical.deviceId,
        ],
      );
      this.writeDocument(noteId, document);
      this.driver.run(
        `INSERT INTO crdt_checkpoints(note_id, checkpoint, state_vector, updated_wall_ms)
         VALUES (?, ?, ?, ?)`,
        [noteId, EMPTY_BLOB, EMPTY_BLOB, wallMs],
      );
      this.refreshFts(noteId);
      this.diagnose({ eventType: 'note_created', entityKind: 'note', entityId: noteId, wallMs });
    });
    return noteId;
  }

  async listNotes(query: ListNotesQuery = {}): Promise<readonly NoteListItem[]> {
    this.requireOpen();
    const sort = query.sort ?? 'modified';
    const archived = query.archived ?? false;
    const trash = query.trash ?? 'active';
    const clauses: string[] = ['archived = ?'];
    const params: SqlValue[] = [archived ? 1 : 0];
    if (trash === 'active') {
      clauses.push('trashed = 0');
    } else if (trash === 'trashed') {
      clauses.push('trashed = 1');
    }
    if (Object.hasOwn(query, 'folderId')) {
      if (query.folderId === null || query.folderId === undefined) {
        clauses.push('folder_id IS NULL');
      } else {
        clauses.push('folder_id = ?');
        params.push(query.folderId);
      }
    }
    const orderBy =
      sort === 'created'
        ? 'pinned DESC, created_wall_ms DESC, id ASC'
        : sort === 'title'
          ? 'pinned DESC, title COLLATE NOCASE ASC, id ASC'
          : sort === 'manual'
            ? 'pinned DESC, manual_position ASC, id ASC'
            : 'pinned DESC, modified_wall_ms DESC, id ASC';
    const sql = `SELECT id, title, folder_id, pinned, archived, trashed, trashed_at_wall_ms,
                        purge_after_wall_ms, created_wall_ms, modified_wall_ms, manual_position
                 FROM notes
                 WHERE ${clauses.join(' AND ')}
                 ORDER BY ${orderBy}`;
    return this.driver.all(sql, params).map((row) => this.noteListItem(row));
  }

  async getNoteDocument(noteId: NoteId): Promise<NoteDocument | null> {
    this.requireOpen();
    const row = this.driver.get(
      `SELECT n.title, d.document_json
       FROM notes n
       JOIN documents d ON d.note_id = n.id
       WHERE n.id = ?`,
      [noteId],
    );
    if (row === undefined) {
      return null;
    }
    return {
      title: asString(row.title, 'title'),
      document: parseDocument(JSON.parse(asString(row.document_json, 'document_json')) as unknown),
    };
  }

  async applyNoteCommand(command: NoteCommand): Promise<void> {
    switch (command.type) {
      case 'create':
        await this.createNote({ noteId: command.noteId, folderId: command.folderId });
        return;
      case 'renameTitle':
        await this.renameTitle(command.noteId, command.title);
        return;
      case 'pin':
        await this.pinNote(command.noteId, command.pinned);
        return;
      case 'archive':
        await this.archiveNote(command.noteId, command.archived);
        return;
      case 'trash':
        await this.trashNote(command.noteId);
        return;
      case 'restore':
        await this.restoreNote(command.noteId);
        return;
      case 'move':
        await this.moveNote(command.noteId, command.folderId);
        return;
      case 'tag':
        if (command.op === 'add') {
          await this.addTagToNote(command.noteId, command.tagId);
        } else {
          await this.removeTagFromNote(command.noteId, command.tagId);
        }
        return;
    }
  }

  async pinNote(noteId: NoteId, pinned: boolean): Promise<void> {
    this.requireOpen();
    this.updateNoteFlags(noteId, { pinned: pinned ? 1 : 0 });
  }

  async archiveNote(noteId: NoteId, archived: boolean): Promise<void> {
    this.requireOpen();
    if (archived) {
      this.updateNoteFlags(noteId, {
        archived: 1,
        trashed: 0,
        trashed_at_wall_ms: null,
        trashed_logical_counter: null,
        trashed_logical_device: null,
        purge_after_wall_ms: null,
      });
    } else {
      this.updateNoteFlags(noteId, { archived: 0 });
    }
  }

  async trashNote(noteId: NoteId): Promise<void> {
    this.requireOpen();
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.updateNoteFlags(noteId, {
      trashed: 1,
      archived: 0,
      pinned: 0,
      trashed_at_wall_ms: wallMs,
      trashed_logical_counter: logical.counter,
      trashed_logical_device: logical.deviceId,
      purge_after_wall_ms: wallMs + TRASH_RETENTION_MS,
    });
    this.diagnose({
      eventType: 'note_trashed',
      entityKind: 'note',
      entityId: noteId,
      wallMs,
    });
  }

  async restoreNote(noteId: NoteId): Promise<void> {
    this.requireOpen();
    this.updateNoteFlags(noteId, {
      trashed: 0,
      trashed_at_wall_ms: null,
      trashed_logical_counter: null,
      trashed_logical_device: null,
      purge_after_wall_ms: null,
    });
  }

  async moveNote(noteId: NoteId, folderId: FolderId | null): Promise<void> {
    this.requireOpen();
    this.updateNoteFlags(noteId, { folder_id: folderId });
  }

  async renameTitle(noteId: NoteId, title: string): Promise<void> {
    this.requireOpen();
    this.updateNoteFlags(noteId, { title });
    this.refreshFts(noteId);
  }

  async createFolder(input: CreateFolderInput): Promise<FolderId> {
    this.requireOpen();
    const name = input.name.trim();
    if (name.length === 0 || name !== input.name) {
      throw new Error('folder names must be non-empty and trimmed');
    }
    const folderId = input.folderId ?? createId<FolderId>();
    const parent = Object.hasOwn(input, 'parentPlacement') ? (input.parentPlacement ?? null) : null;
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    const manual = input.manualPosition ?? `a${String(logical.counter)}`;
    this.driver.run(
      `INSERT INTO folders(
         id, name, parent_id, parent_logical_counter, parent_logical_device, manual_position,
         created_wall_ms, created_logical_counter, created_logical_device,
         modified_wall_ms, modified_logical_counter, modified_logical_device, trashed
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        folderId,
        name,
        parent,
        parent === null ? null : logical.counter,
        parent === null ? null : logical.deviceId,
        manual,
        wallMs,
        logical.counter,
        logical.deviceId,
        wallMs,
        logical.counter,
        logical.deviceId,
      ],
    );
    if (parent !== null) {
      this.repairFolderCycles(wallMs);
    }
    return folderId;
  }

  async listFolders(): Promise<readonly Folder[]> {
    this.requireOpen();
    const rows = this.driver.all(
      `SELECT * FROM folders WHERE trashed = 0 ORDER BY manual_position ASC, name COLLATE NOCASE ASC`,
    );
    return rows.map((row) => this.folderFromRow(row));
  }

  async renameFolder(folderId: FolderId, name: string): Promise<void> {
    this.requireOpen();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed !== name) {
      throw new Error('folder names must be non-empty and trimmed');
    }
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.driver.run(
      `UPDATE folders SET name = ?, modified_wall_ms = ?, modified_logical_counter = ?,
       modified_logical_device = ? WHERE id = ?`,
      [trimmed, wallMs, logical.counter, logical.deviceId, folderId],
    );
  }

  async moveFolder(
    folderId: FolderId,
    parentPlacement: FolderId | null,
  ): Promise<FolderCycleRepairEvent | null> {
    this.requireOpen();
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.driver.run(
      `UPDATE folders SET parent_id = ?, parent_logical_counter = ?, parent_logical_device = ?,
       modified_wall_ms = ?, modified_logical_counter = ?, modified_logical_device = ?
       WHERE id = ?`,
      [
        parentPlacement,
        parentPlacement === null ? null : logical.counter,
        parentPlacement === null ? null : logical.deviceId,
        wallMs,
        logical.counter,
        logical.deviceId,
        folderId,
      ],
    );
    return this.repairFolderCycles(wallMs);
  }

  async trashFolder(folderId: FolderId): Promise<void> {
    this.requireOpen();
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.driver.run(
      `UPDATE folders SET trashed = 1, trashed_at_wall_ms = ?, trashed_logical_counter = ?,
       trashed_logical_device = ?, purge_after_wall_ms = ?,
       modified_wall_ms = ?, modified_logical_counter = ?, modified_logical_device = ?
       WHERE id = ?`,
      [
        wallMs,
        logical.counter,
        logical.deviceId,
        wallMs + TRASH_RETENTION_MS,
        wallMs,
        logical.counter,
        logical.deviceId,
        folderId,
      ],
    );
    this.diagnose({
      eventType: 'folder_trashed',
      entityKind: 'folder',
      entityId: folderId,
      wallMs,
    });
  }

  async restoreFolder(folderId: FolderId): Promise<void> {
    this.requireOpen();
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.driver.run(
      `UPDATE folders SET trashed = 0, trashed_at_wall_ms = NULL, trashed_logical_counter = NULL,
       trashed_logical_device = NULL, purge_after_wall_ms = NULL,
       modified_wall_ms = ?, modified_logical_counter = ?, modified_logical_device = ?
       WHERE id = ?`,
      [wallMs, logical.counter, logical.deviceId, folderId],
    );
  }

  async reorderFolder(folderId: FolderId, manualPosition: string): Promise<void> {
    this.requireOpen();
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.driver.run(
      `UPDATE folders SET manual_position = ?, modified_wall_ms = ?, modified_logical_counter = ?,
       modified_logical_device = ? WHERE id = ?`,
      [manualPosition, wallMs, logical.counter, logical.deviceId, folderId],
    );
  }

  async createTag(input: CreateTagInput): Promise<TagId> {
    this.requireOpen();
    const name = input.name.normalize('NFC').trim();
    if (name.length === 0) {
      throw new Error('tag names must be non-empty after normalization');
    }
    const tagId = input.tagId ?? createId<TagId>();
    const colorRole = Object.hasOwn(input, 'colorRole') ? (input.colorRole ?? null) : null;
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    this.driver.run(
      `INSERT INTO tags(
         id, name, color_role, created_wall_ms, created_logical_counter, created_logical_device,
         modified_wall_ms, modified_logical_counter, modified_logical_device, trashed
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        tagId,
        name,
        colorRole,
        wallMs,
        logical.counter,
        logical.deviceId,
        wallMs,
        logical.counter,
        logical.deviceId,
      ],
    );
    return tagId;
  }

  async listTags(): Promise<readonly Tag[]> {
    this.requireOpen();
    const rows = this.driver.all(
      `SELECT * FROM tags WHERE trashed = 0 ORDER BY name COLLATE NOCASE ASC`,
    );
    return rows.map((row) => this.tagFromRow(row));
  }

  async addTagToNote(noteId: NoteId, tagId: TagId): Promise<void> {
    this.requireOpen();
    this.driver.run(`INSERT OR IGNORE INTO note_tags(note_id, tag_id) VALUES (?, ?)`, [
      noteId,
      tagId,
    ]);
    this.refreshFts(noteId);
  }

  async removeTagFromNote(noteId: NoteId, tagId: TagId): Promise<void> {
    this.requireOpen();
    this.driver.run(`DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?`, [noteId, tagId]);
    this.refreshFts(noteId);
  }

  async listUndoRedo(noteId: NoteId, limit: number): Promise<UndoRedoList> {
    this.requireOpen();
    const take = limit > 0 ? limit : 100;
    const undo = this.driver
      .all(
        `SELECT transaction_id, note_id, inverse, created_wall_ms, stack
         FROM undo_entries WHERE note_id = ? AND stack = 'undo'
         ORDER BY id DESC LIMIT ?`,
        [noteId, take],
      )
      .map((row) => this.undoFromRow(row));
    const redo = this.driver
      .all(
        `SELECT transaction_id, note_id, inverse, created_wall_ms, stack
         FROM undo_entries WHERE note_id = ? AND stack = 'redo'
         ORDER BY id DESC LIMIT ?`,
        [noteId, take],
      )
      .map((row) => this.undoFromRow(row));
    return { undo, redo };
  }

  async saveVersion(
    noteId: NoteId,
    options: { readonly label?: string; readonly tier?: VersionTier } = {},
  ): Promise<VersionSnapshot> {
    this.requireOpen();
    const loaded = await this.getNoteDocument(noteId);
    if (loaded === null) {
      throw new Error(`note not found: ${noteId}`);
    }
    const wallMs = this.clock.wallNow().unixMs;
    const id = createId<TransactionId>();
    const tier = options.tier ?? 'manual';
    const label = options.label ?? null;
    this.driver.run(
      `INSERT INTO version_snapshots(id, note_id, title, document_json, label, tier, created_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        noteId,
        loaded.title,
        canonicalizeDocumentToString(loaded.document),
        label,
        tier,
        wallMs,
      ],
    );
    return {
      id,
      noteId,
      title: loaded.title,
      document: loaded.document,
      label,
      tier,
      createdWallMs: wallMs,
    };
  }

  async listVersions(noteId: NoteId): Promise<readonly VersionSnapshot[]> {
    this.requireOpen();
    return this.driver
      .all(
        `SELECT id, note_id, title, document_json, label, tier, created_wall_ms
         FROM version_snapshots WHERE note_id = ? ORDER BY created_wall_ms DESC`,
        [noteId],
      )
      .map((row) => this.versionFromRow(row));
  }

  async restoreVersion(noteId: NoteId, versionId: TransactionId): Promise<RestoreVersionResult> {
    this.requireOpen();
    const row = this.driver.get(
      `SELECT title, document_json FROM version_snapshots WHERE id = ? AND note_id = ?`,
      [versionId, noteId],
    );
    if (row === undefined) {
      throw new Error(`version not found: ${versionId}`);
    }
    return {
      title: asString(row.title, 'title'),
      document: parseDocument(JSON.parse(asString(row.document_json, 'document_json')) as unknown),
    };
  }

  async considerAutomaticVersion(noteId: NoteId): Promise<VersionSnapshot | null> {
    this.requireOpen();
    const existing = await this.listVersions(noteId);
    const tier = selectAutomaticVersionTier(this.clock.wallNow().unixMs, existing);
    if (tier === null) {
      return null;
    }
    return this.saveVersion(noteId, { tier });
  }

  async importAttachment(input: ImportAttachmentInput): Promise<AttachmentRecord> {
    this.requireOpen();
    const originalName = sanitizeOriginalName(input.originalName);
    const mimeType = input.mimeType.trim().length > 0 ? input.mimeType : 'application/octet-stream';
    const digest = await sha256Bytes(input.bytes);
    const plaintextSha256 = bufferToHex(digest);
    const id = encodeBase32(digest.subarray(0, 16)) as AttachmentId;
    const existing = this.driver.get(`SELECT * FROM attachments WHERE id = ?`, [id]);
    if (existing !== undefined) {
      if (input.noteId !== undefined) {
        this.driver.run(
          `INSERT OR IGNORE INTO attachment_refs(note_id, attachment_id) VALUES (?, ?)`,
          [input.noteId, id],
        );
      }
      return this.attachmentFromRow(existing);
    }
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    let localPath: string | null = null;
    if (this.attachmentsDir !== undefined) {
      localPath = writeAttachmentFile(this.attachmentsDir, id, input.bytes);
    }
    const pixel = input.pixelSize;
    this.driver.run(
      `INSERT INTO attachments(
         id, plaintext_sha256, byte_length, mime_type, original_name, pixel_width, pixel_height,
         local_state, local_path, bytes, created_wall_ms, created_logical_counter, created_logical_device
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?)`,
      [
        id,
        plaintextSha256,
        input.bytes.byteLength,
        mimeType,
        originalName,
        pixel === undefined ? null : pixel.width,
        pixel === undefined ? null : pixel.height,
        localPath,
        input.bytes,
        wallMs,
        logical.counter,
        logical.deviceId,
      ],
    );
    if (localPath !== null) {
      this.driver.run(`INSERT INTO local_files(attachment_id, abs_path) VALUES (?, ?)`, [
        id,
        localPath,
      ]);
    }
    if (input.noteId !== undefined) {
      this.driver.run(
        `INSERT OR IGNORE INTO attachment_refs(note_id, attachment_id) VALUES (?, ?)`,
        [input.noteId, id],
      );
    }
    const row = this.driver.get(`SELECT * FROM attachments WHERE id = ?`, [id]);
    if (row === undefined) {
      throw new Error('attachment insert failed');
    }
    return this.attachmentFromRow(row);
  }

  async listAttachments(noteId?: NoteId): Promise<readonly AttachmentRecord[]> {
    this.requireOpen();
    const rows =
      noteId === undefined
        ? this.driver.all(`SELECT * FROM attachments ORDER BY created_wall_ms ASC`)
        : this.driver.all(
            `SELECT a.* FROM attachments a
             JOIN attachment_refs r ON r.attachment_id = a.id
             WHERE r.note_id = ?
             ORDER BY a.created_wall_ms ASC`,
            [noteId],
          );
    return rows.map((row) => this.attachmentFromRow(row));
  }

  async getAttachmentBytes(attachmentId: AttachmentId): Promise<Uint8Array | null> {
    this.requireOpen();
    const row = this.driver.get(`SELECT bytes FROM attachments WHERE id = ?`, [attachmentId]);
    if (row === undefined) {
      return null;
    }
    return asBytesOrNull(row.bytes, 'bytes');
  }

  async appendDiagnostic(entry: DiagnosticEntry): Promise<void> {
    this.requireOpen();
    this.diagnose(entry);
  }

  async listDiagnostics(limit: number): Promise<readonly DiagnosticEntry[]> {
    this.requireOpen();
    const take = limit > 0 ? limit : 100;
    return this.driver
      .all(
        `SELECT event_type, entity_kind, entity_id, detail_code, wall_ms
         FROM diagnostic_log ORDER BY id DESC LIMIT ?`,
        [take],
      )
      .map((row) => {
        const entry: DiagnosticEntry = {
          eventType: asString(row.event_type, 'event_type'),
          wallMs: asNumber(row.wall_ms, 'wall_ms'),
        };
        const entityKind = asStringOrNull(row.entity_kind, 'entity_kind');
        const entityId = asStringOrNull(row.entity_id, 'entity_id');
        const detailCode = asStringOrNull(row.detail_code, 'detail_code');
        return {
          ...entry,
          ...(entityKind === null ? {} : { entityKind }),
          ...(entityId === null ? {} : { entityId }),
          ...(detailCode === null ? {} : { detailCode }),
        };
      });
  }

  async getCrdtUpdates(noteId: NoteId): Promise<readonly Uint8Array[]> {
    this.requireOpen();
    return this.driver
      .all(`SELECT update_bytes FROM crdt_updates WHERE note_id = ? ORDER BY id ASC`, [noteId])
      .map((row) => asBytes(row.update_bytes, 'update_bytes'));
  }

  async exportVaultSnapshot(): Promise<VaultSnapshot> {
    this.requireOpen();
    const deviceId = this.requireDevice();
    const notes = this.driver.all(
      `SELECT n.id, n.title, n.folder_id, n.pinned, n.archived, n.trashed_at_wall_ms, d.document_json
       FROM notes n JOIN documents d ON d.note_id = n.id`,
    );
    const exportedNotes = notes.map((row) => {
      const noteId = parseId<NoteId>(asString(row.id, 'id'));
      const tagRows = this.driver.all(`SELECT tag_id FROM note_tags WHERE note_id = ?`, [noteId]);
      const document = parseDocument(
        JSON.parse(asString(row.document_json, 'document_json')) as unknown,
      );
      return {
        id: noteId,
        title: asString(row.title, 'title'),
        folderId: parseFolderId(asStringOrNull(row.folder_id, 'folder_id')),
        tags: tagRows.map((tagRow) => parseId<TagId>(asString(tagRow.tag_id, 'tag_id'))),
        pinned: asBool(row.pinned, 'pinned'),
        archived: asBool(row.archived, 'archived'),
        trashedAtWallMs: asNumberOrNull(row.trashed_at_wall_ms, 'trashed_at_wall_ms'),
        canonicalJson: canonicalizeDocumentToString(document),
      };
    });
    const folders = this.driver.all(`SELECT * FROM folders`).map((row) => this.folderFromRow(row));
    const tags = this.driver.all(`SELECT * FROM tags`).map((row) => this.tagFromRow(row));
    const attachments = this.driver.all(`SELECT * FROM attachments`).map((row) => {
      const record = this.attachmentFromRow(row);
      return {
        id: record.id,
        mimeType: record.mimeType,
        originalName: record.originalName,
        byteLength: record.byteLength,
        plaintextSha256: record.plaintextSha256,
        localPath: record.localPath,
        bytes: asBytesOrNull(row.bytes, 'bytes'),
      };
    });
    return { deviceId, notes: exportedNotes, folders, tags, attachments };
  }

  private requireOpen(): void {
    if (!this.opened) {
      throw new Error('LocalStore.open() must be called first');
    }
  }

  private requireDevice(): DeviceId {
    if (this.deviceId === undefined) {
      throw new Error('device id missing');
    }
    return this.deviceId;
  }

  private ensureDevice(): void {
    const row = this.driver.get(`SELECT device_id FROM device_records LIMIT 1`);
    if (row !== undefined) {
      this.deviceId = parseId<DeviceId>(asString(row.device_id, 'device_id'));
      return;
    }
    const deviceId = createId<DeviceId>();
    const wallMs = this.clock.wallNow().unixMs;
    this.driver.run(`INSERT INTO device_records(device_id, created_wall_ms) VALUES (?, ?)`, [
      deviceId,
      wallMs,
    ]);
    this.deviceId = deviceId;
  }

  private nextLogical(): LogicalTime {
    const row = this.driver.get(`SELECT value FROM vault_settings WHERE key = 'logical_counter'`);
    const current = row === undefined ? 0 : Number.parseInt(asString(row.value, 'value'), 10);
    const counter = current + 1;
    this.driver.run(
      `INSERT INTO vault_settings(key, value) VALUES ('logical_counter', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(counter)],
    );
    return { counter, deviceId: this.requireDevice() };
  }

  private ensureFts(): void {
    const existing = this.driver.get(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes_fts'`,
    );
    if (existing !== undefined) {
      return;
    }
    for (const tokenize of FTS_TOKENIZE_ATTEMPTS) {
      try {
        this.driver.exec(
          `CREATE VIRTUAL TABLE notes_fts USING fts5(
             title, body, tags, captions,
             content='notes_search_src',
             content_rowid='rowid',
             ${tokenize}
           )`,
        );
        return;
      } catch {
        // This SQLite build may not support unicode61 diacritic removal.
      }
    }
    // Fallback: default FTS5 tokenizer (often porter/simple). Ranking is still
    // title > tags > body via bm25 weights. Diacritic folding is skipped.
    this.driver.exec(
      `CREATE VIRTUAL TABLE notes_fts USING fts5(
         title, body, tags, captions,
         content='notes_search_src',
         content_rowid='rowid'
       )`,
    );
  }

  private writeDocument(noteId: NoteId, document: Document): void {
    const json = canonicalizeDocumentToString(parseDocument(document));
    this.driver.run(
      `INSERT INTO documents(note_id, document_json, schema_version)
       VALUES (?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         document_json = excluded.document_json,
         schema_version = excluded.schema_version`,
      [noteId, json, SCHEMA_VERSION],
    );
  }

  private applyProjection(projection: NoteProjection, wallMs: number): void {
    const logical = this.nextLogical();
    this.driver.run(
      `UPDATE notes SET title = ?, folder_id = ?, pinned = ?, archived = ?, trashed = ?,
       modified_wall_ms = ?, modified_logical_counter = ?, modified_logical_device = ?
       WHERE id = ?`,
      [
        projection.title,
        projection.folderId,
        projection.pinned ? 1 : 0,
        projection.archived ? 1 : 0,
        projection.trashed ? 1 : 0,
        wallMs,
        logical.counter,
        logical.deviceId,
        projection.noteId,
      ],
    );
  }

  private updateNoteFlags(noteId: NoteId, patch: Record<string, SqlValue>): void {
    const wallMs = this.clock.wallNow().unixMs;
    const logical = this.nextLogical();
    const assignments = Object.keys(patch).map((column) => `${column} = ?`);
    const params: SqlValue[] = Object.values(patch);
    assignments.push(
      'modified_wall_ms = ?',
      'modified_logical_counter = ?',
      'modified_logical_device = ?',
    );
    params.push(wallMs, logical.counter, logical.deviceId, noteId);
    this.driver.run(`UPDATE notes SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  private refreshFts(noteId: NoteId): void {
    const note = this.driver.get(`SELECT title FROM notes WHERE id = ?`, [noteId]);
    if (note === undefined) {
      return;
    }
    const docRow = this.driver.get(`SELECT document_json FROM documents WHERE note_id = ?`, [
      noteId,
    ]);
    let body = '';
    let captions = '';
    if (docRow !== undefined) {
      const document = parseDocument(
        JSON.parse(asString(docRow.document_json, 'document_json')) as unknown,
      );
      body = plainBodyFromDocument(document);
      captions = captionsFromDocument(document);
    }
    const tagRows = this.driver.all(
      `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`,
      [noteId],
    );
    const tags = tagRows.map((row) => asString(row.name, 'name')).join(' ');
    this.driver.run(
      `INSERT INTO notes_search_src(note_id, title, body, tags, captions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         tags = excluded.tags,
         captions = excluded.captions`,
      [noteId, asString(note.title, 'title'), body, tags, captions],
    );
  }

  private repairFolderCycles(wallMs: number): FolderCycleRepairEvent | null {
    let last: FolderCycleRepairEvent | null = null;
    for (;;) {
      const edges = this.loadParentEdges();
      const newest = newestParentEdgeToRemove(edges);
      if (newest === null) {
        return last;
      }
      this.driver.run(
        `UPDATE folders SET parent_id = NULL, parent_logical_counter = NULL, parent_logical_device = NULL
         WHERE id = ?`,
        [newest.childId],
      );
      last = {
        rule: 'remove-newest-parent-edge',
        childId: newest.childId,
        parentId: newest.parentId,
      };
      this.diagnose({
        eventType: 'folder_cycle_repaired',
        entityKind: 'folder',
        entityId: newest.childId,
        detailCode: 'remove-newest-parent-edge',
        wallMs,
      });
    }
  }

  private loadParentEdges(): FolderParentEdge[] {
    const rows = this.driver.all(
      `SELECT id, parent_id, parent_logical_counter, parent_logical_device
       FROM folders WHERE parent_id IS NOT NULL`,
    );
    const edges: FolderParentEdge[] = [];
    for (const row of rows) {
      const parentId = asStringOrNull(row.parent_id, 'parent_id');
      const counter = asNumberOrNull(row.parent_logical_counter, 'parent_logical_counter');
      const device = asStringOrNull(row.parent_logical_device, 'parent_logical_device');
      if (parentId === null || counter === null || device === null) {
        continue;
      }
      edges.push({
        childId: parseId<FolderId>(asString(row.id, 'id')),
        parentId: parseId<FolderId>(parentId),
        logicalTime: { counter, deviceId: parseId<DeviceId>(device) },
      });
    }
    return edges;
  }

  private diagnose(entry: DiagnosticEntry): void {
    this.driver.run(
      `INSERT INTO diagnostic_log(event_type, entity_kind, entity_id, detail_code, wall_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.eventType,
        entry.entityKind ?? null,
        entry.entityId ?? null,
        entry.detailCode ?? null,
        entry.wallMs,
      ],
    );
  }

  private noteListItem(row: SqlRow): NoteListItem {
    return {
      noteId: parseId<NoteId>(asString(row.id, 'id')),
      title: asString(row.title, 'title'),
      folderId: parseFolderId(asStringOrNull(row.folder_id, 'folder_id')),
      pinned: asBool(row.pinned, 'pinned'),
      archived: asBool(row.archived, 'archived'),
      trashed: asBool(row.trashed, 'trashed'),
      trashedAtWallMs: asNumberOrNull(row.trashed_at_wall_ms, 'trashed_at_wall_ms'),
      purgeAfterWallMs: asNumberOrNull(row.purge_after_wall_ms, 'purge_after_wall_ms'),
      createdWallMs: asNumber(row.created_wall_ms, 'created_wall_ms'),
      modifiedWallMs: asNumber(row.modified_wall_ms, 'modified_wall_ms'),
      manualPosition: asString(row.manual_position, 'manual_position'),
    };
  }

  private folderFromRow(row: SqlRow): Folder {
    const created = clockEvent(row, 'created');
    const modified = clockEvent(row, 'modified');
    const trashedAtWall = asNumberOrNull(row.trashed_at_wall_ms, 'trashed_at_wall_ms');
    return validateFolder({
      id: asString(row.id, 'id'),
      name: asString(row.name, 'name'),
      parentPlacement: asStringOrNull(row.parent_id, 'parent_id'),
      manualPosition: asString(row.manual_position, 'manual_position'),
      created,
      modified,
      trashedAt:
        trashedAtWall === null
          ? null
          : {
              logical: {
                counter: asNumber(row.trashed_logical_counter, 'trashed_logical_counter'),
                deviceId: asString(row.trashed_logical_device, 'trashed_logical_device'),
              },
              wallMs: trashedAtWall,
            },
    });
  }

  private tagFromRow(row: SqlRow): Tag {
    const created = clockEvent(row, 'created');
    const modified = clockEvent(row, 'modified');
    const trashedAtWall = asNumberOrNull(row.trashed_at_wall_ms, 'trashed_at_wall_ms');
    return validateTag({
      id: asString(row.id, 'id'),
      name: asString(row.name, 'name'),
      colorRole: asStringOrNull(row.color_role, 'color_role'),
      created,
      modified,
      trashedAt:
        trashedAtWall === null
          ? null
          : {
              logical: {
                counter: asNumber(row.trashed_logical_counter, 'trashed_logical_counter'),
                deviceId: asString(row.trashed_logical_device, 'trashed_logical_device'),
              },
              wallMs: trashedAtWall,
            },
    });
  }

  private attachmentFromRow(row: SqlRow): AttachmentRecord {
    return {
      id: parseId<AttachmentId>(asString(row.id, 'id')),
      plaintextSha256: asString(row.plaintext_sha256, 'plaintext_sha256'),
      byteLength: asNumber(row.byte_length, 'byte_length'),
      mimeType: asString(row.mime_type, 'mime_type'),
      originalName: asString(row.original_name, 'original_name'),
      pixelWidth: asNumberOrNull(row.pixel_width, 'pixel_width'),
      pixelHeight: asNumberOrNull(row.pixel_height, 'pixel_height'),
      localState: asLocalState(asString(row.local_state, 'local_state')),
      localPath: asStringOrNull(row.local_path, 'local_path'),
      createdWallMs: asNumber(row.created_wall_ms, 'created_wall_ms'),
    };
  }

  private undoFromRow(row: SqlRow): StoredUndoEntry {
    const stack = asString(row.stack, 'stack');
    if (stack !== 'undo' && stack !== 'redo') {
      throw new Error(`invalid undo stack ${stack}`);
    }
    return {
      transactionId: parseId<TransactionId>(asString(row.transaction_id, 'transaction_id')),
      noteId: parseId<NoteId>(asString(row.note_id, 'note_id')),
      inverse: asBytes(row.inverse, 'inverse'),
      stack,
      createdWallMs: asNumber(row.created_wall_ms, 'created_wall_ms'),
    };
  }

  private versionFromRow(row: SqlRow): VersionSnapshot {
    const tier = asString(row.tier, 'tier');
    if (tier !== 'hourly' && tier !== 'daily' && tier !== 'weekly' && tier !== 'manual') {
      throw new Error(`invalid version tier ${tier}`);
    }
    return {
      id: parseId<TransactionId>(asString(row.id, 'id')),
      noteId: parseId<NoteId>(asString(row.note_id, 'note_id')),
      title: asString(row.title, 'title'),
      document: parseDocument(JSON.parse(asString(row.document_json, 'document_json')) as unknown),
      label: asStringOrNull(row.label, 'label'),
      tier,
      createdWallMs: asNumber(row.created_wall_ms, 'created_wall_ms'),
    };
  }
}

function emptyDocument(noteId: NoteId): Document {
  return parseDocument({
    type: 'doc',
    id: deriveId(noteId, 'doc', 0),
    content: [],
  });
}

function parseFolderId(value: string | null): FolderId | null {
  if (value === null) {
    return null;
  }
  return parseId<FolderId>(value);
}

function parseOperations(json: string): readonly SchemaOperation[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('operations_json must be an array');
  }
  return parsed as SchemaOperation[];
}

function clockEvent(
  row: SqlRow,
  prefix: 'created' | 'modified',
): {
  readonly logical: LogicalTime;
  readonly wallMs: number;
} {
  return {
    logical: {
      counter: asNumber(row[`${prefix}_logical_counter`], `${prefix}_logical_counter`),
      deviceId: parseId<DeviceId>(
        asString(row[`${prefix}_logical_device`], `${prefix}_logical_device`),
      ),
    },
    wallMs: asNumber(row[`${prefix}_wall_ms`], `${prefix}_wall_ms`),
  };
}

function loadNodeBuiltin(name: 'crypto' | 'fs' | 'path'): unknown {
  const specifier = ['node', name].join(':');
  const getter = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process?.getBuiltinModule;
  if (typeof getter === 'function') {
    const loaded = getter(specifier);
    if (loaded !== undefined && loaded !== null) {
      return loaded;
    }
  }
  const meta = import.meta as ImportMeta & { require?: (id: string) => unknown };
  if (typeof meta.require === 'function') {
    try {
      return meta.require(specifier);
    } catch {
      return null;
    }
  }
  return null;
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  type NodeHash = {
    createHash(algorithm: string): {
      update(data: Uint8Array): { digest(): Uint8Array };
    };
  };
  const nodeCrypto = loadNodeBuiltin('crypto') as NodeHash | null;
  if (nodeCrypto !== null) {
    return new Uint8Array(nodeCrypto.createHash('sha256').update(bytes).digest());
  }
  type WebCrypto = {
    readonly subtle?: {
      digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
    };
  };
  const runtimeCrypto = Reflect.get(globalThis, 'crypto') as WebCrypto | undefined;
  const subtle = runtimeCrypto?.subtle;
  if (subtle !== undefined) {
    return new Uint8Array(await subtle.digest('SHA-256', bytes));
  }
  throw new Error('SHA-256 is unavailable');
}

function writeAttachmentFile(dir: string, id: string, bytes: Uint8Array): string {
  type NodeFs = {
    mkdirSync(path: string, options: { recursive: boolean }): unknown;
    writeFileSync(path: string, data: Uint8Array): void;
  };
  type NodePath = { join(...parts: string[]): string };
  const fs = loadNodeBuiltin('fs') as NodeFs | null;
  const path = loadNodeBuiltin('path') as NodePath | null;
  if (fs === null || path === null) {
    throw new Error('attachmentsDir requires node:fs');
  }
  fs.mkdirSync(dir, { recursive: true });
  const localPath = path.join(dir, id);
  fs.writeFileSync(localPath, bytes);
  return localPath;
}

function sanitizeOriginalName(name: string): string {
  const base = name.replaceAll(/[/\\:\0]/g, '_').trim();
  return base.length > 0 ? base : 'attachment';
}

function bufferToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function asLocalState(value: string): AttachmentRecord['localState'] {
  if (
    value === 'available' ||
    value === 'evicted' ||
    value === 'importing' ||
    value === 'corrupt' ||
    value === 'absent'
  ) {
    return value;
  }
  throw new Error(`unknown attachment localState ${value}`);
}
