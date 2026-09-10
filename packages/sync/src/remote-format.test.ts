import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRemoteHead, REMOTE_FORMAT_VERSION } from './remote-format.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/remote-format/head-unencrypted.json',
);

describe('@jot/sync remote format', () => {
  it('parses the version 1 unencrypted head fixture', async () => {
    const json: unknown = JSON.parse(await readFile(fixturePath, 'utf8'));
    const head = parseRemoteHead(json);
    expect(head.remoteFormatVersion).toBe(REMOTE_FORMAT_VERSION);
    expect(head.kind).toBe('head');
    expect(head.encryption).toEqual({ mode: 'none' });
    expect(head.announcedObjects).toEqual([]);
    expect(head.vaultId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});
