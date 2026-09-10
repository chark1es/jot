import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  flattenFolderTree,
  folderPathLabel,
  packageName,
  sortNotes,
  visibleNotes,
  type FolderRecord,
  type SortableNote,
} from './index.js';

function folder(
  id: string,
  name: string,
  parentId: string | null,
  manualPosition = 'a0',
): FolderRecord {
  return { id, name, parentId, manualPosition };
}

function note(partial: Partial<SortableNote> & Pick<SortableNote, 'id'>): SortableNote {
  return {
    title: partial.title ?? partial.id,
    pinned: partial.pinned ?? false,
    archived: partial.archived ?? false,
    trashed: partial.trashed ?? false,
    createdMs: partial.createdMs ?? 0,
    modifiedMs: partial.modifiedMs ?? 0,
    manualPosition: partial.manualPosition ?? 'a0',
    folderId: partial.folderId ?? null,
    tagIds: partial.tagIds ?? [],
    ...partial,
  };
}

describe('@jot/ui-mobile', () => {
  it('imports', () => {
    expect(packageName).toBe('@jot/ui-mobile');
  });

  it('builds a nested folder tree and skips cycles', () => {
    const folders = [
      folder('root', 'Work', null, 'a1'),
      folder('child', 'Projects', 'root', 'a1'),
      folder('cycle-a', 'Loop A', 'cycle-b', 'a2'),
      folder('cycle-b', 'Loop B', 'cycle-a', 'a2'),
      folder('inbox', 'Inbox', null, 'a0'),
    ];
    const tree = buildFolderTree(folders);
    expect(tree.map((node) => node.folder.id)).toEqual(['inbox', 'root']);
    const work = tree[1];
    expect(work?.children.map((node) => node.folder.id)).toEqual(['child']);
    expect(flattenFolderTree(tree).map((node) => node.folder.id)).toEqual([
      'inbox',
      'root',
      'child',
    ]);
    expect(folderPathLabel(folders, 'child')).toBe('Work / Projects');
  });

  it('pins notes on top and sorts the rest', () => {
    const notes = [
      note({ id: 'b', title: 'Beta', modifiedMs: 30, pinned: false }),
      note({ id: 'a', title: 'Alpha', modifiedMs: 10, pinned: true }),
      note({ id: 'c', title: 'Gamma', modifiedMs: 20, pinned: false }),
    ];
    expect(sortNotes(notes, 'modified').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortNotes(notes, 'title').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters archive and trash as list modes', () => {
    const notes = [
      note({ id: 'live', modifiedMs: 3 }),
      note({ id: 'pin', pinned: true, modifiedMs: 1 }),
      note({ id: 'old', archived: true, modifiedMs: 9 }),
      note({ id: 'gone', trashed: true, modifiedMs: 8 }),
    ];
    expect(
      visibleNotes(notes, {
        mode: 'notes',
        sort: 'modified',
        folderId: null,
        tagId: null,
      }).map((item) => item.id),
    ).toEqual(['pin', 'live']);
    expect(
      visibleNotes(notes, { mode: 'archive', sort: 'modified', folderId: null, tagId: null }).map(
        (item) => item.id,
      ),
    ).toEqual(['old']);
    expect(
      visibleNotes(notes, { mode: 'trash', sort: 'modified', folderId: null, tagId: null }).map(
        (item) => item.id,
      ),
    ).toEqual(['gone']);
  });
});
