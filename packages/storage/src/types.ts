import type { Brand } from './brand.js';

/** Logical Vault identity. Provider file IDs stay inside adapters. */
export type VaultId = Brand<string, 'VaultId'>;

/** Provider-owned namespace handle returned after identify or create. */
export type StorageNamespace = Brand<string, 'StorageNamespace'>;

/** Logical object key. Never a provider file ID. */
export type ObjectKey = Brand<string, 'ObjectKey'>;

/** Opaque provider version used for conditional delete and read identity. */
export type ProviderVersion = Brand<string, 'ProviderVersion'>;

/** Hex-encoded SHA-256 of object bytes. */
export type ContentHash = Brand<string, 'ContentHash'>;

export type ListCursor = Brand<string, 'ListCursor'>;

export type ChangeCursor = Brand<string, 'ChangeCursor'>;

export type ObjectRef = {
  readonly namespace: StorageNamespace;
  readonly key: ObjectKey;
  readonly providerVersion: ProviderVersion;
};

export type ObjectMetadata = {
  readonly ref: ObjectRef;
  readonly byteLength: number;
  readonly contentHash: ContentHash;
};

export type ByteRange = {
  readonly offset: number;
  readonly length: number;
};

export type ObjectRead = {
  readonly providerVersion: ProviderVersion;
  readonly bytes: AsyncIterable<Uint8Array>;
};

export type ListPage = {
  readonly items: readonly ObjectMetadata[];
  readonly nextCursor: ListCursor | null;
};

export type IdentifyNamespaceResult =
  | { readonly outcome: 'found'; readonly namespace: StorageNamespace }
  | { readonly outcome: 'notFound' };

export type StatResult =
  | { readonly outcome: 'found'; readonly metadata: ObjectMetadata }
  | { readonly outcome: 'notFound' };

export type DeleteResult = { readonly outcome: 'deleted' } | { readonly outcome: 'conflict' };

export type VaultBootstrap = {
  readonly vaultId: VaultId;
  readonly remoteFormatVersion: number;
};

export type ChangeKind = 'upsert' | 'delete';

export type ChangeEvent = {
  readonly key: ObjectKey;
  readonly kind: ChangeKind;
  readonly metadata: ObjectMetadata | null;
};

export type ChangeBatch = {
  readonly cursor: ChangeCursor;
  readonly changes: readonly ChangeEvent[];
};

/**
 * Limits and optional optimizations. List, streaming read, immutable create,
 * delete, and a repeatable change cursor or complete relist fallback are required.
 */
export type StorageCapabilities = {
  readonly maxObjectBytes: number;
  readonly maxListLimit: number;
  readonly rangeReads: boolean;
  readonly providerChecksums: boolean;
  readonly changeCursor: boolean;
  readonly completeRelistFallback: boolean;
};
