import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = path.dirname(fileURLToPath(import.meta.url));

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(srcDir);
  return entries
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(srcDir, name));
}

describe('change-wakeup imports', () => {
  it('source files do not import schema or Drive file modules', async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const importLines = text.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        expect(line, file).not.toMatch(/schema/i);
        expect(line, file).not.toContain('Drive file');
      }
    }
  });
});
