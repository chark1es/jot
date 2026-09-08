// TODO: import allowed-field constants from @jolt/change-wakeup once that
// package exports the relay protocol field lists. Duplicated here for Phase 0.

export const ALLOWED_FIELDS = {
  topics: [
    'topicId',
    'enrollmentCapabilityVerifier',
    'dirtyEpoch',
    'createdAt',
    'lastActivityAt',
    'expiryPolicy',
  ],
  devices: [
    'deviceId',
    'topicId',
    'deviceCapabilityVerifier',
    'platform',
    'encryptedNotificationEndpoint',
    'lastDeliveryStatus',
    'expiry',
  ],
  channels: [
    'channelId',
    'topicId',
    'channelTokenHash',
    'driveChangeResourceId',
    'expiration',
    'lastNotificationAt',
  ],
  rate_limits: ['hashedAbuseKey', 'timeBucket', 'count', 'expiry'],
} as const;

export type RelayTable = keyof typeof ALLOWED_FIELDS;

export const FORBIDDEN_FIELDS = [
  'noteText',
  'note_text',
  'text',
  'body',
  'title',
  'titles',
  'driveToken',
  'drive_token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'crdt',
  'crdtBytes',
  'crdt_bytes',
  'yjsUpdate',
  'updateBytes',
  'googleAccountId',
  'google_account_id',
  'googleId',
  'googleUserId',
  'accountId',
  'fileName',
  'file_name',
  'filename',
  'oauth',
  'oauthCode',
  'oauth_token',
  'authorizationCode',
  'authCode',
  'idToken',
  'encryptionKey',
  'encryption_key',
  'wrappedKey',
  'vaultKey',
  'masterKey',
  'secretKey',
  'passphrase',
] as const;

const forbiddenNormalized = new Set(FORBIDDEN_FIELDS.map(normalizeField));

export class RelayPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayPolicyError';
  }
}

export function normalizeField(name: string): string {
  return name.replace(/[_-]/g, '').toLowerCase();
}

export function assertNoUserContent(record: Record<string, unknown>, table?: RelayTable): void {
  walk(record, '$');

  if (table === undefined) {
    return;
  }

  const allowed = new Set<string>(ALLOWED_FIELDS[table]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new RelayPolicyError(`field ${key} is not permitted on ${table}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${String(index)}]`);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeField(key);
    if (forbiddenNormalized.has(normalized)) {
      throw new RelayPolicyError(`forbidden field ${path}.${key}`);
    }
    walk(nested, `${path}.${key}`);
  }
}
