import { describe, expect, it } from 'vitest';
import { assertRelayPayload, RelayPayloadError } from './assert.js';
import type { AssertRelayPayload } from './assert.js';
import {
  RELAY_FORBIDDEN_FIELDS,
  RELAY_FORBIDDEN_PAYLOAD_KEYS,
  RELAY_RECORD_POLICY,
  relayPolicyFieldNames,
} from './policy.js';

describe('Relay record policy', () => {
  it('cannot contain forbidden field names', () => {
    const policyJson = JSON.stringify(RELAY_RECORD_POLICY);
    const names = relayPolicyFieldNames();
    for (const forbidden of RELAY_FORBIDDEN_FIELDS) {
      expect(names).not.toContain(forbidden);
      expect(policyJson).not.toContain(`"${forbidden}"`);
    }
    for (const key of RELAY_FORBIDDEN_PAYLOAD_KEYS) {
      expect(names).not.toContain(key);
    }
  });

  it('assertRelayPayload rejects forbidden keys', () => {
    expect(() => {
      assertRelayPayload({ title: 'secret note' });
    }).toThrow(RelayPayloadError);
    expect(() => {
      assertRelayPayload({ body: 'user text' });
    }).toThrow(/forbidden/);
    expect(() => {
      assertRelayPayload({ refreshToken: 'xyz' });
    }).toThrow(/forbidden/);
    expect(() => {
      assertRelayPayload({ crdtUpdate: '00' });
    }).toThrow(/forbidden/);
  });

  it('assertRelayPayload rejects unknown keys', () => {
    expect(() => {
      assertRelayPayload({ noteId: 'abc' });
    }).toThrow(/unknown/);
  });

  it('assertRelayPayload accepts closed topic fields', () => {
    expect(() => {
      assertRelayPayload({
        opaqueTopicId: 'a'.repeat(64),
        dirtyEpoch: 1,
      });
    }).not.toThrow();
  });

  it('type-level AssertRelayPayload rejects forbidden keys', () => {
    type Good = AssertRelayPayload<{ opaqueTopicId: string }>;
    type Bad = AssertRelayPayload<{ title: string }>;
    const good: Good = { opaqueTopicId: 'x' };
    const _neverCheck: [Bad] extends [never] ? true : false = true;
    expect(good.opaqueTopicId).toBe('x');
    expect(_neverCheck).toBe(true);
  });
});
