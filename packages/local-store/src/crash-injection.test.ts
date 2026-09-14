import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'vitest';
import { createId, deriveId, parseDocument } from '@jot/schema';
import type { NodeId, NoteId, TransactionId } from '@jot/schema';
import { createStatementDriver } from './driver.js';
import type { SqliteDriver, SqlRow, SqlValue } from './driver.js';
import { createSqliteLocalStore } from './sqlite-store.js';
import type { LocalStore } from './store.js';
import type { CommitEditInput } from './types.js';

class SimulatedCrash extends Error {}

type CrashMode = 'throw' | 'kill';

/**
 * Fails the Nth write statement while armed. `throw` lets the transaction roll back the way an
 * exception does. `kill` copies the database files while the transaction is still open, which is
 * what the disk holds when a process dies mid-commit; the test then restarts from that copy.
 */
class FaultInjectingDriver implements SqliteDriver {
  statements = 0;
  private readonly inner: SqliteDriver;
  private failAt: number | null = null;
  private armed = false;
  private mode: CrashMode = 'throw';

  constructor(
    private readonly db: Database,
    private readonly path: string,
    readonly crashPath: string,
  ) {
    this.inner = createStatementDriver(db);
  }

  arm(failAt: number | null, mode: CrashMode): void {
    this.armed = true;
    this.failAt = failAt;
    this.mode = mode;
    this.statements = 0;
  }

  disarm(): void {
    this.armed = false;
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  run(sql: string, params?: readonly SqlValue[]): void {
    this.tick();
    this.inner.run(sql, params);
  }

  all(sql: string, params?: readonly SqlValue[]): SqlRow[] {
    return this.inner.all(sql, params);
  }

  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined {
    return this.inner.get(sql, params);
  }

  transaction<T>(fn: () => T): T {
    if (!this.armed || this.mode === 'throw') {
      return this.inner.transaction(fn);
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (error instanceof SimulatedCrash) {
        copyFileSync(this.path, this.crashPath);
        if (existsSync(`${this.path}-wal`)) {
          copyFileSync(`${this.path}-wal`, `${this.crashPath}-wal`);
        }
      }
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.inner.close();
  }

  private tick(): void {
    if (!this.armed) {
      return;
    }
    this.statements += 1;
    if (this.failAt !== null && this.statements === this.failAt) {
      throw new SimulatedCrash(`crash at write statement ${String(this.failAt)}`);
    }
  }
}

function edit(noteId: NoteId, docId: NodeId, text: string): CommitEditInput {
  const paragraphId = deriveId(docId, 'paragraph', 0);
  const transactionId = createId<TransactionId>();
  return {
    transactionId,
    noteId,
    operations: [],
    crdtUpdate: new Uint8Array([1, 2, 3]),
    document: parseDocument({
      type: 'doc',
      id: docId,
      content: [{ type: 'paragraph', id: paragraphId, content: [{ type: 'text', id: deriveId(paragraphId, 'text', 0), text, marks: [] }] }],
    }),
    projection: { noteId, title: text, folderId: null, pinned: false, archived: false, trashed: false, plainBody: text },
    undo: { transactionId, noteId, inverse: new Uint8Array([4]) },
    outbox: { transactionId, noteId, payload: new Uint8Array([5]) },
  };
}

type Restarted = {
  readonly store: LocalStore;
  readonly noteId: NoteId;
  readonly docId: NodeId;
  readonly failed: CommitEditInput;
  readonly crashed: boolean;
  readonly statements: number;
  readonly cleanup: () => Promise<void>;
};

/** Commits "alpha", then commits "bravo" with a fault armed, then reopens the database file. */
async function crashDuringSecondEdit(failAt: number | null, mode: CrashMode): Promise<Restarted> {
  const dir = mkdtempSync(join(tmpdir(), 'jot-crash-'));
  const path = join(dir, 'vault.sqlite');
  const driver = new FaultInjectingDriver(new Database(path), path, join(dir, 'after-crash.sqlite'));
  const first = createSqliteLocalStore(driver);
  await first.open();
  const noteId = await first.createNote();
  const docId = (await first.getNoteDocument(noteId))?.document.id;
  if (docId === undefined) {
    throw new Error('created note has no document');
  }
  await first.commitEdit(edit(noteId, docId, 'alpha words'));
  const failed = edit(noteId, docId, 'bravo words');
  driver.arm(failAt, mode);
  let crashed = false;
  try {
    await first.commitEdit(failed);
  } catch (error) {
    if (!(error instanceof SimulatedCrash)) {
      throw error;
    }
    crashed = true;
  }
  driver.disarm();
  await first.close();
  const reopened = crashed && mode === 'kill' ? driver.crashPath : path;
  const store = createSqliteLocalStore(createStatementDriver(new Database(reopened)));
  await store.open();
  return {
    store,
    noteId,
    docId,
    failed,
    crashed,
    statements: driver.statements,
    cleanup: async () => {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function body(store: LocalStore, noteId: NoteId): Promise<string | undefined> {
  return (await store.getNoteProjection(noteId))?.plainBody;
}

describe('crash injection during commitEdit', () => {
  it('leaves the last committed edit, then applies the lost one exactly once', async () => {
    const baseline = await crashDuringSecondEdit(null, 'throw');
    const writes = baseline.statements;
    expect(baseline.crashed).toBe(false);
    expect(writes).toBeGreaterThan(5);
    await baseline.cleanup();

    for (const mode of ['throw', 'kill'] as const) {
      for (let failAt = 1; failAt <= writes; failAt += 1) {
        const run = await crashDuringSecondEdit(failAt, mode);
        const where = `${mode} at write ${String(failAt)} of ${String(writes)}`;
        try {
          expect(run.crashed, where).toBe(true);
          expect(await body(run.store, run.noteId), where).toBe('alpha words');
          expect((await run.store.search({ text: 'bravo', limit: 10 })).hits, where).toHaveLength(0);
          expect((await run.store.search({ text: 'alpha', limit: 10 })).hits.map((hit) => hit.noteId), where).toEqual([run.noteId]);
          expect(await run.store.listAppliedTransactionIds(run.noteId, 10), where).not.toContain(run.failed.transactionId);
          const undoBefore = (await run.store.listUndoRedo(run.noteId, 50)).undo.length;

          // The editor journal still holds the edit, so the app replays it after relaunch.
          await run.store.commitEdit(run.failed);
          expect(await body(run.store, run.noteId), where).toBe('bravo words');
          expect((await run.store.search({ text: 'bravo', limit: 10 })).hits, where).toHaveLength(1);
          expect((await run.store.listUndoRedo(run.noteId, 50)).undo.length, where).toBe(undoBefore + 1);

          // A second replay, from a journal row not yet marked applied, changes nothing.
          await run.store.commitEdit(run.failed);
          expect((await run.store.listUndoRedo(run.noteId, 50)).undo.length, where).toBe(undoBefore + 1);
        } finally {
          await run.cleanup();
        }
      }
    }
  });

  it('keeps an edit that committed before the process died, and skips its replay', async () => {
    const run = await crashDuringSecondEdit(null, 'kill');
    try {
      expect(run.crashed).toBe(false);
      expect(await body(run.store, run.noteId)).toBe('bravo words');
      expect(await run.store.listAppliedTransactionIds(run.noteId, 10)).toContain(run.failed.transactionId);
      const undo = (await run.store.listUndoRedo(run.noteId, 50)).undo.length;
      await run.store.commitEdit(run.failed);
      expect((await run.store.listUndoRedo(run.noteId, 50)).undo.length).toBe(undo);
      expect(await body(run.store, run.noteId)).toBe('bravo words');
    } finally {
      await run.cleanup();
    }
  });
});
