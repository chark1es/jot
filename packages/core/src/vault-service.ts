import type { LocalStore } from '@jot/local-store';
import type { Document, NoteId, SchemaOperation, TransactionId } from '@jot/schema';
import { createId } from '@jot/schema';
import type { Clock } from './clock.js';
import { YjsCrdtDocument } from './yjs-document.js';

function plainBodyFromDocument(document: Document): string {
  const parts: string[] = [];
  const walk = (node: Document | Document['content'][number]): void => {
    if (node.type === 'text') {
      parts.push(node.text ?? '');
    }
    for (const child of node.content) {
      walk(child);
    }
  };
  walk(document);
  return parts.join('');
}

/**
 * CRDT-aware vault operations on top of LocalStore.
 * Restore writes a new Committed edit; it never rewinds CRDT clocks.
 */
export class VaultService {
  constructor(
    private readonly store: LocalStore,
    readonly clock: Clock,
  ) {}

  open(): Promise<void> {
    return this.store.open();
  }

  close(): Promise<void> {
    return this.store.close();
  }

  createNote(title = ''): Promise<NoteId> {
    return this.store.createNote({ title });
  }

  async commitOperations(input: {
    readonly noteId: NoteId;
    readonly transactionId: TransactionId;
    readonly operations: readonly SchemaOperation[];
    readonly undoInverse: Uint8Array;
  }): Promise<void> {
    const crdt = await this.loadCrdt(input.noteId);
    crdt.applySchemaOperations(input.operations, input.transactionId);
    await this.persistCrdt(input.noteId, input.transactionId, input.operations, crdt, input.undoInverse);
  }

  async restoreVersionAsEdit(
    noteId: NoteId,
    versionId: TransactionId,
    transactionId: TransactionId = createId<TransactionId>(),
  ): Promise<void> {
    const snapshot = await this.store.restoreVersion(noteId, versionId);
    const crdt = await this.loadCrdt(noteId);
    crdt.replaceFromCanonical(snapshot.document, snapshot.title);
    await this.persistCrdt(noteId, transactionId, [], crdt, new Uint8Array());
  }

  private async loadCrdt(noteId: NoteId): Promise<YjsCrdtDocument> {
    const loaded = await this.store.getNoteDocument(noteId);
    if (loaded === null) {
      throw new Error(`note not found: ${noteId}`);
    }
    const crdt = YjsCrdtDocument.fromCanonical(loaded.document, loaded.title);
    const updates = await this.store.getCrdtUpdates(noteId);
    for (const update of updates) {
      if (update.byteLength > 0) {
        crdt.applyUpdate(update);
      }
    }
    return crdt;
  }

  private async persistCrdt(
    noteId: NoteId,
    transactionId: TransactionId,
    operations: readonly SchemaOperation[],
    crdt: YjsCrdtDocument,
    undoInverse: Uint8Array,
  ): Promise<void> {
    const document = crdt.getCanonicalDocument();
    const title = crdt.getTitle();
    const projection = await this.store.getNoteProjection(noteId);
    if (projection === null) {
      throw new Error(`note not found: ${noteId}`);
    }
    const encoded = crdt.encodeUpdate();
    await this.store.commitEdit({
      transactionId,
      noteId,
      operations,
      crdtUpdate: encoded,
      document,
      projection: {
        ...projection,
        title,
        plainBody: plainBodyFromDocument(document),
      },
      undo: { transactionId, noteId, inverse: undoInverse },
      outbox: { transactionId, noteId, payload: encoded },
    });
  }
}
