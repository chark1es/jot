import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { relaySchema } from '../convex/schema.js';
import {
  ALLOWED_FIELDS,
  assertNoUserContent,
  RelayPolicyError,
  type RelayTable,
} from './policy.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN_PACKAGES = [
  '@jot/schema',
  '@jot/core',
  '@jot/sync',
  '@jot/storage-google-drive',
] as const;

function expectForbidden(record: Record<string, unknown>): void {
  expect(() => {
    assertNoUserContent(record);
  }).toThrow(RelayPolicyError);
}

function expectAllowed(record: Record<string, unknown>, table: RelayTable): void {
  expect(() => {
    assertNoUserContent(record, table);
  }).not.toThrow();
}

describe('assertNoUserContent', () => {
  test('rejects note text', () => {
    expectForbidden({ noteText: 'buy milk' });
    expectForbidden({ text: 'buy milk' });
    expectForbidden({ body: 'buy milk' });
  });

  test('rejects titles', () => {
    expectForbidden({ title: 'Shopping' });
    expectForbidden({ titles: ['Shopping'] });
  });

  test('rejects drive tokens', () => {
    expectForbidden({ driveToken: 'ya29.token' });
    expectForbidden({ accessToken: 'ya29.token' });
  });

  test('rejects refresh tokens', () => {
    expectForbidden({ refreshToken: '1//refresh' });
    expectForbidden({ refresh_token: '1//refresh' });
  });

  test('rejects CRDT bytes', () => {
    expectForbidden({ crdtBytes: new Uint8Array([1, 2, 3]) });
    expectForbidden({ yjsUpdate: 'AQID' });
  });

  test('rejects Google account ids', () => {
    expectForbidden({ googleAccountId: '123456789' });
    expectForbidden({ google_account_id: '123456789' });
  });

  test('rejects file names', () => {
    expectForbidden({ fileName: 'note.md' });
    expectForbidden({ filename: 'pack.jobj' });
  });

  test('rejects OAuth fields', () => {
    expectForbidden({ oauth: 'code' });
    expectForbidden({ authorizationCode: '4/0A' });
    expectForbidden({ idToken: 'eyJ' });
  });

  test('rejects encryption keys', () => {
    expectForbidden({ encryptionKey: 'abc' });
    expectForbidden({ wrappedKey: 'abc' });
    expectForbidden({ passphrase: 'secret' });
  });

  test('rejects nested forbidden keys', () => {
    expectForbidden({ device: { title: 'nested' } });
  });

  test('accepts a permitted topics row', () => {
    expectAllowed(
      {
        topicId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
        enrollmentCapabilityVerifier: 'verifier',
        dirtyEpoch: 1,
        createdAt: 0,
        lastActivityAt: 0,
        expiryPolicy: '90d',
      },
      'topics',
    );
  });

  test('rejects unknown fields on a named table', () => {
    expect(() => {
      assertNoUserContent({ topicId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', noteId: 'nope' }, 'topics');
    }).toThrow(RelayPolicyError);
  });
});

describe('schema tables', () => {
  test('only list permitted fields', () => {
    const tables = ['topics', 'devices', 'channels', 'rate_limits'] as const;
    for (const table of tables) {
      expect(Object.keys(relaySchema[table]).sort()).toEqual([...ALLOWED_FIELDS[table]].sort());
    }
  });
});

describe('package isolation', () => {
  test('does not depend on content packages', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    for (const name of FORBIDDEN_PACKAGES) {
      expect(declared[name]).toBeUndefined();
    }
  });

  test('source does not import content packages', () => {
    const files = listTsFiles(pkgRoot);
    const joined = files.map((path) => `${path}\n${readFileSync(path, 'utf8')}`).join('\n');
    for (const name of FORBIDDEN_PACKAGES) {
      expect(joined.includes(`from '${name}'`)).toBe(false);
      expect(joined.includes(`from "${name}"`)).toBe(false);
      expect(joined.includes(`require('${name}')`)).toBe(false);
    }
  });
});

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      break;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (entry.name.endsWith('.ts')) {
        out.push(path);
      }
    }
  }
  return out;
}
