import type {
  CommitEditInput,
  IntakeRecord,
  NoteProjection,
  SearchQuery,
  SearchResult,
} from './types.js';
import type { NoteId } from '@jolt/schema';

/**
 * Platform-neutral local durability module.
 *
 * Runs SQLite in WAL mode on every target. `local-store-expo` uses expo-sqlite;
 * `local-store-tauri` uses Rust SQLite. This package owns the interface only.
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
  commitEdit(input: CommitEditInput): Promise<void>;
  getNoteProjection(noteId: NoteId): Promise<NoteProjection | null>;
  replayUnappliedIntake(): Promise<readonly IntakeRecord[]>;
  search(query: SearchQuery): Promise<SearchResult>;
}
