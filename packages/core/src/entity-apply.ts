import type { ClockEvent, FolderId, TagId } from '@jot/schema';
import type { NoteCommand } from './commands.js';
import { newestParentEdgeToRemove, type FolderParentEdge } from './folder-cycle.js';

export type NoteEntityState = {
  readonly title: string;
  readonly folderId: FolderId | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashedAt: ClockEvent | null;
  readonly tags: ReadonlySet<TagId>;
};

/**
 * Apply a NoteCommand to a local projection. Tag add/remove is an OR-set of rows
 * locally; concurrent merge is Phase 2.
 */
export function applyNoteCommand(
  state: NoteEntityState,
  command: NoteCommand,
  now: ClockEvent,
): NoteEntityState {
  switch (command.type) {
    case 'create':
      return {
        title: '',
        folderId: command.folderId,
        pinned: false,
        archived: false,
        trashedAt: null,
        tags: new Set(),
      };
    case 'renameTitle':
      return { ...state, title: command.title };
    case 'pin':
      return { ...state, pinned: command.pinned };
    case 'archive':
      return command.archived
        ? { ...state, archived: true, trashedAt: null }
        : { ...state, archived: false };
    case 'trash':
      return { ...state, archived: false, pinned: false, trashedAt: now };
    case 'restore':
      return { ...state, trashedAt: null };
    case 'move':
      return { ...state, folderId: command.folderId };
    case 'tag': {
      const tags = new Set(state.tags);
      if (command.op === 'add') {
        tags.add(command.tagId);
      } else {
        tags.delete(command.tagId);
      }
      return { ...state, tags };
    }
  }
}

export function applyFolderMove(
  edges: readonly FolderParentEdge[],
  childId: FolderId,
  parentId: FolderId | null,
  logicalTime: ClockEvent['logical'],
): { readonly edges: readonly FolderParentEdge[]; readonly removed: FolderParentEdge | null } {
  const next = edges.filter((edge) => edge.childId !== childId);
  if (parentId !== null) {
    next.push({ childId, parentId, logicalTime });
  }
  const repair = newestParentEdgeToRemove(next);
  if (repair === null) {
    return { edges: next, removed: null };
  }
  return {
    edges: next.filter(
      (edge) => !(edge.childId === repair.removedEdge.childId && edge.parentId === repair.removedEdge.parentId),
    ),
    removed: repair.removedEdge,
  };
}
