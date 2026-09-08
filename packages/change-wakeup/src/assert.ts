import {
  RELAY_CALLBACK_URL_MAX,
  RELAY_FORBIDDEN_FIELDS,
  RELAY_FORBIDDEN_PAYLOAD_KEYS,
  RELAY_RECORD_POLICY,
  RELAY_REQUEST_SHAPES,
  relayAllowedPayloadKeys,
} from './policy.js';

export class RelayPayloadError extends Error {
  override readonly name = 'RelayPayloadError';
}

const FORBIDDEN_KEY_SET: ReadonlySet<string> = new Set(RELAY_FORBIDDEN_PAYLOAD_KEYS);
const ALLOWED_KEYS = relayAllowedPayloadKeys();

const MAX_BY_KEY: ReadonlyMap<string, number> = (() => {
  const max = new Map<string, number>();
  const ingest = (record: Record<string, unknown>): void => {
    for (const [key, spec] of Object.entries(record)) {
      if (typeof spec === 'object' && spec !== null && 'maxLength' in spec) {
        const length = spec.maxLength;
        if (typeof length === 'number') {
          max.set(key, length);
        }
      }
    }
  };
  for (const record of Object.values(RELAY_RECORD_POLICY)) {
    ingest(record);
  }
  for (const shape of Object.values(RELAY_REQUEST_SHAPES)) {
    ingest(shape);
  }
  max.set('callbackUrl', RELAY_CALLBACK_URL_MAX);
  max.set('channelToken', 64);
  max.set('encryptedEndpoint', 512);
  return max;
})();

export type ClosedRelayPayload = { readonly [key: string]: string | number | bigint };

/**
 * Rejects any key in RELAY_FORBIDDEN_FIELDS / RELAY_FORBIDDEN_PAYLOAD_KEYS
 * and any key outside the closed Relay records and request shapes.
 */
export function assertRelayPayload(payload: unknown): asserts payload is ClosedRelayPayload {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RelayPayloadError('Relay payload must be a closed object');
  }

  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      throw new RelayPayloadError(`forbidden Relay field: ${key}`);
    }
    for (const label of RELAY_FORBIDDEN_FIELDS) {
      if (key === label) {
        throw new RelayPayloadError(`forbidden Relay field: ${key}`);
      }
    }
    if (!ALLOWED_KEYS.has(key)) {
      throw new RelayPayloadError(`unknown Relay field: ${key}`);
    }
    const value = record[key];
    const max = MAX_BY_KEY.get(key);
    if (max !== undefined && typeof value === 'string' && value.length > max) {
      throw new RelayPayloadError(`Relay field exceeds max length: ${key}`);
    }
  }
}

type ForbiddenIntersection<T> = Extract<keyof T, RelayForbiddenPayloadKeyFromConst>;

type RelayForbiddenPayloadKeyFromConst = (typeof RELAY_FORBIDDEN_PAYLOAD_KEYS)[number];

/**
 * Type-level gate: a payload type that includes a forbidden key becomes never.
 */
export type AssertRelayPayload<T extends object> =
  ForbiddenIntersection<T> extends never ? T : never;
