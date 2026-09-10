import { zipSync } from 'fflate';
import type { ExportFile } from './types.js';

export function archiveExportFiles(files: readonly ExportFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.path] = file.bytes;
  }
  return zipSync(entries, { level: 6 });
}
