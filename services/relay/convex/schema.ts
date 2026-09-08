import { type ALLOWED_FIELDS, type RelayTable } from '../src/policy.js';

/**
 * Phase 0 description of the relay metadata tables.
 * Not a deployed Convex app. Field names are the design 3.6 permit list.
 */
export const relaySchema = {
  topics: {
    topicId: 'string',
    enrollmentCapabilityVerifier: 'string',
    dirtyEpoch: 'number',
    createdAt: 'number',
    lastActivityAt: 'number',
    expiryPolicy: 'string',
  },
  devices: {
    deviceId: 'string',
    topicId: 'string',
    deviceCapabilityVerifier: 'string',
    platform: 'string',
    encryptedNotificationEndpoint: 'string',
    lastDeliveryStatus: 'string',
    expiry: 'number',
  },
  channels: {
    channelId: 'string',
    topicId: 'string',
    channelTokenHash: 'string',
    driveChangeResourceId: 'string',
    expiration: 'number',
    lastNotificationAt: 'number',
  },
  rate_limits: {
    hashedAbuseKey: 'string',
    timeBucket: 'number',
    count: 'number',
    expiry: 'number',
  },
} as const satisfies {
  [Table in RelayTable]: {
    [Field in (typeof ALLOWED_FIELDS)[Table][number]]: 'string' | 'number';
  };
};

export type RelaySchema = typeof relaySchema;
