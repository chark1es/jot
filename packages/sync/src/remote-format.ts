export const REMOTE_FORMAT_VERSION = 1 as const;

export const REMOTE_MAGIC = 'JOLT' as const;

export const REMOTE_OBJECT_KINDS = [
  'crdtDeltaPack',
  'crdtCheckpoint',
  'attachment',
  'versionSnapshot',
  'catalogShard',
  'tombstonePack',
  'deviceAcknowledgement',
] as const;

export type RemoteObjectKind = (typeof REMOTE_OBJECT_KINDS)[number];

export type RemoteFileKind = RemoteObjectKind | 'head' | 'catalog';

export type RemoteEncryption =
  | { readonly mode: 'none' }
  | {
      readonly mode: 'namedSuite';
      readonly suiteId: 'xchacha20poly1305-v1';
      readonly nonce: string;
    };

/**
 * Envelope fields present on every remote file from the first commit.
 */
export type RemoteEnvelope = {
  readonly magic: typeof REMOTE_MAGIC;
  readonly remoteFormatVersion: typeof REMOTE_FORMAT_VERSION;
  readonly minReaderVersion: number;
  readonly minWriterVersion: number;
  readonly vaultId: string;
  readonly objectId: string;
  readonly kind: RemoteFileKind;
  readonly createdByDeviceId: string;
  readonly deviceSequence: number;
  readonly schemaVersion: number;
  readonly encryption: RemoteEncryption;
  readonly plaintextLength: number;
  readonly ciphertextLength: number;
  readonly payloadSha256: string;
};

export type AnnouncedObjectDescriptor = {
  readonly objectId: string;
  readonly kind: RemoteObjectKind;
  readonly payloadSha256: string;
  readonly byteLength: number;
};

export type CheckpointCoverage = {
  readonly noteId: string;
  readonly stateVectorSha256: string;
};

/**
 * Device-owned Head. Announces immutable Remote objects published by that Device.
 */
export type RemoteHead = RemoteEnvelope & {
  readonly kind: 'head';
  readonly priorHeadHash: string | null;
  readonly announcedObjects: readonly AnnouncedObjectDescriptor[];
  readonly checkpointCoverageVectors: readonly CheckpointCoverage[];
};

export type CatalogShardRef = {
  readonly objectId: string;
  readonly payloadSha256: string;
};

/**
 * Catalog: compact snapshot of Vault metadata and object references.
 */
export type RemoteCatalog = RemoteEnvelope & {
  readonly kind: 'catalog';
  readonly shards: readonly CatalogShardRef[];
};

export class RemoteFormatError extends Error {
  override readonly name = 'RemoteFormatError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expectString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new RemoteFormatError(`missing string field ${key}`);
  }
  return value;
}

function expectNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RemoteFormatError(`missing integer field ${key}`);
  }
  return value;
}

function isRemoteObjectKind(value: string): value is RemoteObjectKind {
  return (REMOTE_OBJECT_KINDS as readonly string[]).includes(value);
}

function parseEncryption(value: unknown): RemoteEncryption {
  if (!isRecord(value)) {
    throw new RemoteFormatError('encryption must be an object');
  }
  if (value['mode'] === 'none') {
    return { mode: 'none' };
  }
  throw new RemoteFormatError('unsupported encryption mode');
}

function parseAnnounced(value: unknown): readonly AnnouncedObjectDescriptor[] {
  if (!Array.isArray(value)) {
    throw new RemoteFormatError('announcedObjects must be an array');
  }
  const out: AnnouncedObjectDescriptor[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new RemoteFormatError('announced object must be an object');
    }
    const kind = expectString(item, 'kind');
    if (!isRemoteObjectKind(kind)) {
      throw new RemoteFormatError(`unknown object kind ${kind}`);
    }
    out.push({
      objectId: expectString(item, 'objectId'),
      kind,
      payloadSha256: expectString(item, 'payloadSha256'),
      byteLength: expectNumber(item, 'byteLength'),
    });
  }
  return out;
}

function parseCoverage(value: unknown): readonly CheckpointCoverage[] {
  if (!Array.isArray(value)) {
    throw new RemoteFormatError('checkpointCoverageVectors must be an array');
  }
  const out: CheckpointCoverage[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new RemoteFormatError('coverage vector must be an object');
    }
    out.push({
      noteId: expectString(item, 'noteId'),
      stateVectorSha256: expectString(item, 'stateVectorSha256'),
    });
  }
  return out;
}

export function parseRemoteHead(json: unknown): RemoteHead {
  if (!isRecord(json)) {
    throw new RemoteFormatError('head must be an object');
  }
  const remoteFormatVersion = expectNumber(json, 'remoteFormatVersion');
  if (remoteFormatVersion !== REMOTE_FORMAT_VERSION) {
    throw new RemoteFormatError(`unsupported remoteFormatVersion ${String(remoteFormatVersion)}`);
  }
  const magic = expectString(json, 'magic');
  if (magic !== REMOTE_MAGIC) {
    throw new RemoteFormatError(`unsupported magic ${magic}`);
  }
  const kind = expectString(json, 'kind');
  if (kind !== 'head') {
    throw new RemoteFormatError(`expected kind head, got ${kind}`);
  }
  const prior = json['priorHeadHash'];
  if (prior !== null && typeof prior !== 'string') {
    throw new RemoteFormatError('priorHeadHash must be string or null');
  }
  return {
    magic: REMOTE_MAGIC,
    remoteFormatVersion: REMOTE_FORMAT_VERSION,
    minReaderVersion: expectNumber(json, 'minReaderVersion'),
    minWriterVersion: expectNumber(json, 'minWriterVersion'),
    vaultId: expectString(json, 'vaultId'),
    objectId: expectString(json, 'objectId'),
    kind: 'head',
    createdByDeviceId: expectString(json, 'createdByDeviceId'),
    deviceSequence: expectNumber(json, 'deviceSequence'),
    schemaVersion: expectNumber(json, 'schemaVersion'),
    encryption: parseEncryption(json['encryption']),
    plaintextLength: expectNumber(json, 'plaintextLength'),
    ciphertextLength: expectNumber(json, 'ciphertextLength'),
    payloadSha256: expectString(json, 'payloadSha256'),
    priorHeadHash: prior,
    announcedObjects: parseAnnounced(json['announcedObjects']),
    checkpointCoverageVectors: parseCoverage(json['checkpointCoverageVectors']),
  };
}
