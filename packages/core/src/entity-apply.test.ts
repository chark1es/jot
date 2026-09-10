import { describe, expect, it } from 'vitest';
import { createId } from '@jot/schema';
import type { FolderId, NoteId, TagId } from '@jot/schema';
import { applyFolderMove, applyNoteCommand } from './entity-apply.js';
import type { NoteEntityState } from './entity-apply.js';
import type { DeviceId } from '@jot/schema';

const now = {
  logical: { counter: 1, deviceId: 'daaaaaaaaaaaaaaaaaaaaaaaaa' as DeviceId },
  wallMs: 1_000,
};

function emptyState(): NoteEntityState {
  return {
    title: '',
    folderId: null,
    pinned: false,
    archived: false,
    trashedAt: null,
    tags: new Set(),
  };
}

describe('entity-apply', () => {
  it('adds and removes tags as a local OR-set of rows', () => {
    const noteId = createId<NoteId>();
    const tagId = createId<TagId>();
    const added = applyNoteCommand(emptyState(), { type: 'tag', noteId, tagId, op: 'add' }, now);
    expect(added.tags.has(tagId)).toBe(true);
    const removed = applyNoteCommand(added, { type: 'tag', noteId, tagId, op: 'remove' }, now);
    expect(removed.tags.has(tagId)).toBe(false);
  });

  it('trash clears archived and records trashedAt', () => {
    const noteId = createId<NoteId>();
    const archived = applyNoteCommand(emptyState(), { type: 'archive', noteId, archived: true }, now);
    const trashed = applyNoteCommand(archived, { type: 'trash', noteId }, now);
    expect(trashed.archived).toBe(false);
    expect(trashed.trashedAt).toEqual(now);
  });

  it('folder move uses newestParentEdgeToRemove', () => {
    const a = createId<FolderId>();
    const b = createId<FolderId>();
    const c = createId<FolderId>();
    const deviceId = 'dddddddddddddddddddddddddd' as DeviceId;
    const first = applyFolderMove([], b, a, { counter: 1, deviceId });
    const second = applyFolderMove(first.edges, c, b, { counter: 2, deviceId });
    const cycle = applyFolderMove(second.edges, a, c, { counter: 9, deviceId });
    expect(cycle.removed?.childId).toBe(a);
    expect(cycle.edges.some((edge) => edge.childId === a && edge.parentId === c)).toBe(false);
  });
});
