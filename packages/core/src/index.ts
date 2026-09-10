import type { ChangeWakeup } from '@jot/change-wakeup';
import type { CryptoEngine } from '@jot/crypto';
import type { LocalStore } from '@jot/local-store';
import type { StorageProvider } from '@jot/storage';

export type { Clock, LogicalTime, WallTime } from './clock.js';
export { compareLogicalTime, nextLogicalTime } from './clock.js';
export type { CrdtDocument } from './crdt.js';
export { NotImplementedError, UnsupportedCrdtDocument } from './crdt.js';
export { CrdtApplyError, PHASE1_MARK_TYPES, YjsCrdtDocument } from './yjs-document.js';
export type { IntakeLedger, IntakeLedgerRecord } from './materializer.js';
export { EditMaterializer, MemoryIntakeLedger } from './materializer.js';
export type { FolderCommand, NoteCommand, TagCommand } from './commands.js';
export { FOLDER_CYCLE_REPAIR_RULE, newestParentEdgeToRemove } from './folder-cycle.js';
export type { FolderCycleRepair, FolderParentEdge } from './folder-cycle.js';
export type { NoteEntityState } from './entity-apply.js';
export { applyFolderMove, applyNoteCommand } from './entity-apply.js';
export { VaultService } from './vault-service.js';
export { canReadRemote, canWriteRemote, evaluateSchemaGate } from './schema-gate.js';
export type { SchemaGate } from './schema-gate.js';

/** Composition of Phase 0 seams. Adapters bind these later. */
export type CoreSeams = {
  readonly storage: StorageProvider;
  readonly crypto: CryptoEngine;
  readonly localStore: LocalStore;
  readonly changeWakeup: ChangeWakeup;
};
