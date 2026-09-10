import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { archiveExportFiles } from './archive.js';

describe('archiveExportFiles', () => {
  it('keeps every exported file and its path in one portable archive', () => {
    const archive = archiveExportFiles([
      { path: 'inbox/first.md', bytes: new TextEncoder().encode('First') },
      { path: 'inbox/first.attachments/photo.bin', bytes: new Uint8Array([1, 2, 3]) },
      { path: 'manifest.json', bytes: new TextEncoder().encode('{"version":1}') },
    ]);

    const files = unzipSync(archive);
    expect(Object.keys(files).sort()).toEqual([
      'inbox/first.attachments/photo.bin',
      'inbox/first.md',
      'manifest.json',
    ]);
    expect(strFromU8(files['inbox/first.md'] ?? new Uint8Array())).toBe('First');
    expect(files['inbox/first.attachments/photo.bin']).toEqual(new Uint8Array([1, 2, 3]));
  });
});
