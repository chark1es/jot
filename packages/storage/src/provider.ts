import type {
  ByteRange,
  ChangeBatch,
  ChangeCursor,
  ContentHash,
  DeleteResult,
  IdentifyNamespaceResult,
  ListCursor,
  ListPage,
  ObjectKey,
  ObjectRead,
  ObjectRef,
  ProviderVersion,
  StatResult,
  StorageCapabilities,
  StorageNamespace,
  VaultBootstrap,
  VaultId,
} from './types.js';

/**
 * Immutable object storage plus a change cursor.
 *
 * Object keys are logical. Provider file IDs stay inside adapters.
 *
 * `writeImmutable` may return an existing object only if length and hash match.
 *
 * `watchChanges` may poll and may emit duplicates. The caller checkpoints its cursor.
 *
 * `delete` is always best-effort cleanup. Correctness cannot depend on it.
 */
export interface StorageProvider {
  identifyNamespace(vaultId: VaultId): Promise<IdentifyNamespaceResult>;
  createNamespace(vaultBootstrap: VaultBootstrap): Promise<StorageNamespace>;
  list(
    namespace: StorageNamespace,
    prefix: ObjectKey | '',
    cursor: ListCursor | null,
    limit: number,
  ): Promise<ListPage>;
  stat(objectRef: ObjectRef): Promise<StatResult>;
  read(objectRef: ObjectRef, range: ByteRange | null): Promise<ObjectRead>;
  writeImmutable(
    namespace: StorageNamespace,
    key: ObjectKey,
    bytes: AsyncIterable<Uint8Array>,
    expectedLength: number,
    expectedHash: ContentHash,
  ): Promise<ObjectRef>;
  delete(objectRef: ObjectRef, expectedProviderVersion: ProviderVersion): Promise<DeleteResult>;
  getChangeCursor(namespace: StorageNamespace): Promise<ChangeCursor>;
  watchChanges(
    namespace: StorageNamespace,
    cursor: ChangeCursor,
    abortSignal: AbortSignal,
  ): AsyncIterable<ChangeBatch>;
  capabilities(): StorageCapabilities;
}
