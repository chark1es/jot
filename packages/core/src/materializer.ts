import type { SchemaOperation, TransactionId } from '@jot/schema';
import type { CrdtDocument } from './crdt.js';

/**
 * Durable intake ledger the materializer reads after crash.
 * Native journals and MemoryIntakeLedger implement this. Phase 1 LocalStore
 * owns SQLite `editor_intake` / `applied_transactions`.
 */
export type IntakeLedgerRecord = {
  readonly transactionId: TransactionId;
  readonly operations: readonly SchemaOperation[];
};

export interface IntakeLedger {
  listUnapplied(): Promise<readonly IntakeLedgerRecord[]>;
  markApplied(transactionId: TransactionId): Promise<void>;
}

export type CommitMaterializedEdit = (record: IntakeLedgerRecord) => Promise<void>;

export class MemoryIntakeLedger implements IntakeLedger {
  private readonly rows: { record: IntakeLedgerRecord; applied: boolean }[] = [];

  append(record: IntakeLedgerRecord): Promise<void> {
    this.rows.push({ record, applied: false });
    return Promise.resolve();
  }

  listUnapplied(): Promise<readonly IntakeLedgerRecord[]> {
    return Promise.resolve(this.rows.filter((row) => !row.applied).map((row) => row.record));
  }

  markApplied(transactionId: TransactionId): Promise<void> {
    const row = this.rows.find((item) => item.record.transactionId === transactionId);
    if (row !== undefined) {
      row.applied = true;
    }
    return Promise.resolve();
  }
}

/**
 * Applies committed journal records to CrdtDocument. IME composition has no
 * API here; candidates never call applySchemaOperations.
 */
export class EditMaterializer {
  private encoded: Uint8Array | undefined;
  private applied = 0;
  private lastId: TransactionId | undefined;
  private readonly seen = new Set<string>();

  constructor(
    private readonly crdt: CrdtDocument,
    private readonly ledger: IntakeLedger,
  ) {}

  async materialize(
    record: IntakeLedgerRecord,
    commitDurably: CommitMaterializedEdit,
  ): Promise<void> {
    this.crdt.applySchemaOperations(record.operations, record.transactionId);
    this.encoded = this.crdt.encodeUpdate();
    await commitDurably(record);
    await this.ledger.markApplied(record.transactionId);
    this.lastId = record.transactionId;
    if (!this.seen.has(record.transactionId)) {
      this.seen.add(record.transactionId);
      this.applied += 1;
    }
  }

  async recover(commitDurably: CommitMaterializedEdit): Promise<void> {
    const unapplied = await this.ledger.listUnapplied();
    for (const record of unapplied) {
      await this.materialize(record, commitDurably);
    }
  }

  appliedCount(): number {
    return this.applied;
  }

  lastTransactionId(): TransactionId | undefined {
    return this.lastId;
  }

  lastUpdate(): Uint8Array {
    return this.encoded ?? this.crdt.encodeUpdate();
  }
}
