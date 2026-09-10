import type { NoteId, SchemaOperation, TransactionId } from '@jot/schema';
import type { DocumentRevision, TransactionOrigin } from './index.js';

export type DurableIntakeRecord = {
  readonly id: TransactionId;
  readonly documentId: NoteId;
  readonly baseRevision: DocumentRevision;
  readonly operations: readonly SchemaOperation[];
  readonly inverses: readonly SchemaOperation[];
  readonly origin: TransactionOrigin;
};

export interface DurableIntake {
  append(record: DurableIntakeRecord): Promise<void>;
  listUnapplied(): Promise<readonly DurableIntakeRecord[]>;
  markApplied(id: TransactionId): Promise<void>;
}

export class MemoryDurableIntake implements DurableIntake {
  private readonly records: { record: DurableIntakeRecord; applied: boolean }[] = [];

  append(record: DurableIntakeRecord): Promise<void> {
    this.records.push({ record, applied: false });
    return Promise.resolve();
  }

  listUnapplied(): Promise<readonly DurableIntakeRecord[]> {
    return Promise.resolve(this.records.filter((row) => !row.applied).map((row) => row.record));
  }

  markApplied(id: TransactionId): Promise<void> {
    const row = this.records.find((item) => item.record.id === id);
    if (row !== undefined) {
      row.applied = true;
    }
    return Promise.resolve();
  }
}
