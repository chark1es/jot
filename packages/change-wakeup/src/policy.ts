/**
 * Fields the Relay must reject. Official clients never send User content.
 */
export const RELAY_FORBIDDEN_FIELDS = Object.freeze([
  'titles',
  'file names',
  'Drive IDs for Jot objects',
  'Drive cursors',
  'Google account identifiers',
  'OAuth material',
  'encryption keys',
  'CRDT state',
  'attachment metadata',
  'diagnostic logs',
  'note bodies',
  'user content',
] as const);

export type RelayForbiddenField = (typeof RELAY_FORBIDDEN_FIELDS)[number];

/**
 * JSON keys that would express User content or credentials.
 * Used by assertRelayPayload together with RELAY_FORBIDDEN_FIELDS.
 */
export const RELAY_FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  'title',
  'titles',
  'fileName',
  'fileNames',
  'filename',
  'file_name',
  'originalName',
  'driveFileId',
  'drive_file_id',
  'googleFileId',
  'fileId',
  'driveCursor',
  'startPageToken',
  'pageToken',
  'googleAccount',
  'googleUserId',
  'accountId',
  'email',
  'accessToken',
  'refreshToken',
  'authorizationCode',
  'oauthToken',
  'vmk',
  'kek',
  'encryptionKey',
  'privateKey',
  'passphrase',
  'crdt',
  'yjs',
  'crdtUpdate',
  'updateBytes',
  'attachment',
  'mimeType',
  'plaintextSha256',
  'diagnostic',
  'diagnosticLog',
  'body',
  'document',
  'noteBody',
  'plaintext',
  'userContent',
  'content',
] as const);

export type RelayForbiddenPayloadKey = (typeof RELAY_FORBIDDEN_PAYLOAD_KEYS)[number];

const HEX_MAX = 64;
const ENDPOINT_MAX = 512;
const URL_MAX = 256;
const STATUS_MAX = 32;
const PLATFORM_MAX = 16;

type LengthField = { readonly maxLength: number };
type EnumField<T extends string> = { readonly enum: readonly T[] };
type UintField = { readonly integer: 'uint64' | 'uint32' | 'unixMs' };

/**
 * Allowed Relay metadata fields from design 3.6.
 * No free-form User content. Field lengths are closed.
 */
export const RELAY_RECORD_POLICY = {
  topics: {
    opaqueTopicId: { maxLength: HEX_MAX },
    enrollmentCapabilityVerifier: { maxLength: HEX_MAX },
    dirtyEpoch: { integer: 'uint64' },
    createdTime: { integer: 'unixMs' },
    lastActivity: { integer: 'unixMs' },
    expiryPolicy: { maxLength: STATUS_MAX },
  },
  devices: {
    opaqueDeviceId: { maxLength: HEX_MAX },
    topicId: { maxLength: HEX_MAX },
    deviceCapabilityVerifier: { maxLength: HEX_MAX },
    platform: { enum: ['apns', 'fcm', 'desktop'] },
    encryptedNotificationEndpoint: { maxLength: ENDPOINT_MAX },
    lastDeliveryStatus: { maxLength: STATUS_MAX },
    expiry: { integer: 'unixMs' },
  },
  channels: {
    channelId: { maxLength: HEX_MAX },
    topicId: { maxLength: HEX_MAX },
    channelTokenHash: { maxLength: HEX_MAX },
    opaqueChangeFeedResourceId: { maxLength: 128 },
    expiration: { integer: 'unixMs' },
    lastNotificationTime: { integer: 'unixMs' },
  },
  rate_limits: {
    hashedAbuseKey: { maxLength: HEX_MAX },
    timeBucket: { integer: 'unixMs' },
    count: { integer: 'uint32' },
    expiry: { integer: 'unixMs' },
  },
} as const satisfies {
  readonly topics: Record<string, LengthField | UintField>;
  readonly devices: Record<string, LengthField | EnumField<string> | UintField>;
  readonly channels: Record<string, LengthField | UintField>;
  readonly rate_limits: Record<string, LengthField | UintField>;
};

export type RelayRecordPolicy = typeof RELAY_RECORD_POLICY;

export const RELAY_REQUEST_SHAPES = {
  registerDevice: {
    opaqueTopicId: { maxLength: HEX_MAX },
    enrollmentCapability: { maxLength: HEX_MAX },
    notificationEndpoint: { maxLength: ENDPOINT_MAX },
    platform: { enum: ['apns', 'fcm', 'desktop'] },
    idempotencyKey: { maxLength: HEX_MAX },
  },
  prepareDriveChannel: {
    opaqueTopicId: { maxLength: HEX_MAX },
    deviceCapability: { maxLength: HEX_MAX },
    idempotencyKey: { maxLength: HEX_MAX },
  },
  observeDirtyEpoch: {
    opaqueTopicId: { maxLength: HEX_MAX },
    afterEpoch: { integer: 'uint64' },
    deviceCapability: { maxLength: HEX_MAX },
  },
} as const;

export type RelayRequestShapes = typeof RELAY_REQUEST_SHAPES;

export function relayPolicyFieldNames(): readonly string[] {
  const names: string[] = [];
  for (const record of Object.values(RELAY_RECORD_POLICY)) {
    for (const field of Object.keys(record)) {
      names.push(field);
    }
  }
  return names;
}

export function relayAllowedPayloadKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const record of Object.values(RELAY_RECORD_POLICY)) {
    for (const field of Object.keys(record)) {
      keys.add(field);
    }
  }
  for (const shape of Object.values(RELAY_REQUEST_SHAPES)) {
    for (const field of Object.keys(shape)) {
      keys.add(field);
    }
  }
  keys.add('channelToken');
  keys.add('callbackUrl');
  keys.add('encryptedEndpoint');
  return keys;
}

export const RELAY_CALLBACK_URL_MAX = URL_MAX;
export const RELAY_PLATFORM_MAX = PLATFORM_MAX;
