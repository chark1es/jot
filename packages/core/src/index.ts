import type { ChangeWakeup } from '@jolt/change-wakeup';
import type { CryptoEngine } from '@jolt/crypto';
import type { LocalStore } from '@jolt/local-store';
import type { StorageProvider } from '@jolt/storage';

export type { Clock, LogicalTime, WallTime } from './clock.js';
export { compareLogicalTime, nextLogicalTime } from './clock.js';
export type { CrdtDocument } from './crdt.js';
export { NotImplementedError, UnsupportedCrdtDocument } from './crdt.js';
export type { NoteCommand } from './commands.js';
export { FOLDER_CYCLE_REPAIR_RULE, newestParentEdgeToRemove } from './folder-cycle.js';
export type { FolderCycleRepair, FolderParentEdge } from './folder-cycle.js';
export { canReadRemote, canWriteRemote, evaluateSchemaGate } from './schema-gate.js';
export type { SchemaGate } from './schema-gate.js';

/** Composition of Phase 0 seams. Adapters bind these later. */
export type CoreSeams = {
  readonly storage: StorageProvider;
  readonly crypto: CryptoEngine;
  readonly localStore: LocalStore;
  readonly changeWakeup: ChangeWakeup;
};
