export type NoteSort = 'modified' | 'created' | 'title' | 'manual';

export type ListMode = 'notes' | 'archive' | 'trash';

export type SortableNote = {
  readonly id: string;
  readonly title: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly createdMs: number;
  readonly modifiedMs: number;
  readonly manualPosition: string;
  readonly folderId: string | null;
  readonly tagIds: readonly string[];
};

export function filterNotesByMode<T extends SortableNote>(
  notes: readonly T[],
  mode: ListMode,
): T[] {
  return notes.filter((note) => {
    switch (mode) {
      case 'archive':
        return note.archived && !note.trashed;
      case 'trash':
        return note.trashed;
      case 'notes':
        return !note.archived && !note.trashed;
    }
  });
}

export function filterNotesByFolder<T extends SortableNote>(
  notes: readonly T[],
  folderId: string | null,
): T[] {
  if (folderId === null) {
    return [...notes];
  }
  return notes.filter((note) => note.folderId === folderId);
}

export function filterNotesByTag<T extends SortableNote>(
  notes: readonly T[],
  tagId: string | null,
): T[] {
  if (tagId === null) {
    return [...notes];
  }
  return notes.filter((note) => note.tagIds.includes(tagId));
}

function comparePinned(a: SortableNote, b: SortableNote): number {
  if (a.pinned === b.pinned) {
    return 0;
  }
  return a.pinned ? -1 : 1;
}

export function compareNotes(a: SortableNote, b: SortableNote, sort: NoteSort): number {
  const pinned = comparePinned(a, b);
  if (pinned !== 0) {
    return pinned;
  }
  switch (sort) {
    case 'created':
      return b.createdMs - a.createdMs;
    case 'title': {
      const left = a.title.trim() === '' ? 'Untitled' : a.title;
      const right = b.title.trim() === '' ? 'Untitled' : b.title;
      return left.localeCompare(right);
    }
    case 'manual':
      return a.manualPosition.localeCompare(b.manualPosition);
    case 'modified':
      return b.modifiedMs - a.modifiedMs;
  }
}

export function sortNotes<T extends SortableNote>(notes: readonly T[], sort: NoteSort): T[] {
  return [...notes].sort((a, b) => compareNotes(a, b, sort));
}

export function visibleNotes<T extends SortableNote>(
  notes: readonly T[],
  options: {
    readonly mode: ListMode;
    readonly sort: NoteSort;
    readonly folderId: string | null;
    readonly tagId: string | null;
  },
): T[] {
  const byMode = filterNotesByMode(notes, options.mode);
  const byFolder = filterNotesByFolder(byMode, options.folderId);
  const byTag = filterNotesByTag(byFolder, options.tagId);
  return sortNotes(byTag, options.sort);
}
