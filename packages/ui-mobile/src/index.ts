/**
 * Pure helpers for the mobile application. StyleSheet + tokens live in the app.
 * NativeWind is not a dependency.
 */
export const packageName = '@jot/ui-mobile';

export {
  buildFolderTree,
  descendantIds,
  findSubtree,
  flattenFolderTree,
  folderPathLabel,
  type FolderRecord,
  type FolderTreeNode,
} from './folder-tree.js';
export { paletteForScheme, type ColorSchemeName, type SemanticPalette } from './palette.js';
export {
  compareNotes,
  filterNotesByFolder,
  filterNotesByMode,
  filterNotesByTag,
  sortNotes,
  visibleNotes,
  type ListMode,
  type NoteSort,
  type SortableNote,
} from './sort-notes.js';
