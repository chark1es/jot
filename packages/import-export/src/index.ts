import type { NoteCommand } from '@jolt/core';
import type { NoteId } from '@jolt/schema';

/**
 * README: Markdown, Apple Notes conversion, portable archive.
 * Phase 0 stub. No production implementation.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export type ExportRequest = {
  readonly noteIds: readonly NoteId[];
};

export function exportNotes(request: ExportRequest, commands: readonly NoteCommand[]): never {
  throw new NotImplementedError(
    `NotImplemented export notes=${String(request.noteIds.length)} commands=${String(commands.length)}`,
  );
}
