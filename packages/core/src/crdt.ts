import type { Document, SchemaOperation, TransactionId } from '@jot/schema';

/**
 * Narrow CRDT seam. Yjs types must not escape this interface.
 *
 * IME composition never calls applySchemaOperations. Native editors keep
 * marked/composing text entirely outside this seam until commit or cancel.
 */
export interface CrdtDocument {
  applyUpdate(bytes: Uint8Array): void;
  encodeUpdate(since?: Uint8Array): Uint8Array;
  getCanonicalDocument(): Document;
  getTitle(): string;
  getStateVector(): Uint8Array;
  /**
   * Apply schema operations in one CRDT transaction.
   * Duplicate `transactionId` delivery is a no-op.
   * Phase 0.5 stores applied ids on the wrapper (JS Set). The durable
   * sync ledger (`applied_transactions`) is the later exactly-once record
   * and is not this Set.
   */
  applySchemaOperations(ops: readonly SchemaOperation[], transactionId: TransactionId): void;
}

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

/** Phase 0 stub used where Yjs is not wired. */
export class UnsupportedCrdtDocument implements CrdtDocument {
  applyUpdate(_bytes: Uint8Array): void {
    throw new NotImplementedError('CrdtDocument.applyUpdate is not implemented');
  }

  encodeUpdate(_since?: Uint8Array): Uint8Array {
    throw new NotImplementedError('CrdtDocument.encodeUpdate is not implemented');
  }

  getCanonicalDocument(): Document {
    throw new NotImplementedError('CrdtDocument.getCanonicalDocument is not implemented');
  }

  getTitle(): string {
    throw new NotImplementedError('CrdtDocument.getTitle is not implemented');
  }

  getStateVector(): Uint8Array {
    throw new NotImplementedError('CrdtDocument.getStateVector is not implemented');
  }

  applySchemaOperations(_ops: readonly SchemaOperation[], _transactionId: TransactionId): void {
    throw new NotImplementedError('CrdtDocument.applySchemaOperations is not implemented');
  }
}
