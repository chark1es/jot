import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELAY_FORBIDDEN_FIELDS, RELAY_FORBIDDEN_PAYLOAD_KEYS } from '@jot/change-wakeup';
import { describe, expect, it } from 'vitest';
import { createRelayChangeWakeup, RelayNotConfiguredError } from './index.js';
import type { RelayClientConfig } from './index.js';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('@jot/change-wakeup-relay', () => {
  it('throws RelayNotConfiguredError for every method', async () => {
    const wakeup = createRelayChangeWakeup({ baseUrl: 'https://relay.invalid', timeoutMs: 1 });
    await expect(
      wakeup.registerDevice('t' as never, 'e' as never, {
        platform: 'desktop',
        encryptedEndpoint: 'x' as never,
      }),
    ).rejects.toBeInstanceOf(RelayNotConfiguredError);
    await expect(wakeup.prepareDriveChannel('t' as never, 'd' as never)).rejects.toBeInstanceOf(
      RelayNotConfiguredError,
    );
  });

  it('config cannot express user content keys', () => {
    const config: RelayClientConfig = { baseUrl: 'https://relay.invalid', timeoutMs: 1000 };
    const keys = Object.keys(config);
    for (const forbidden of RELAY_FORBIDDEN_FIELDS) {
      expect(keys.join(',')).not.toContain(forbidden);
    }
    for (const key of RELAY_FORBIDDEN_PAYLOAD_KEYS) {
      expect(keys).not.toContain(key);
    }
  });

  it('package does not import schema, sync, or storage-google-drive', async () => {
    const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toEqual(['@jot/change-wakeup']);
    expect(deps).not.toContain('@jot/schema');
    expect(deps).not.toContain('@jot/sync');
    expect(deps).not.toContain('@jot/storage-google-drive');

    const source = await readFile(path.join(pkgDir, 'src/index.ts'), 'utf8');
    expect(source).not.toContain('@jot/schema');
    expect(source).not.toContain('@jot/sync');
    expect(source).not.toContain('@jot/storage-google-drive');
  });
});
