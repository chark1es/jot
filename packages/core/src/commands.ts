import type { FolderId, NoteId, TagId } from '@jolt/schema';

export type NoteCommand =
  | { readonly type: 'create'; readonly noteId: NoteId; readonly folderId: FolderId | null }
  | { readonly type: 'renameTitle'; readonly noteId: NoteId; readonly title: string }
  | { readonly type: 'pin'; readonly noteId: NoteId; readonly pinned: boolean }
  | { readonly type: 'archive'; readonly noteId: NoteId; readonly archived: boolean }
  | { readonly type: 'trash'; readonly noteId: NoteId }
  | { readonly type: 'restore'; readonly noteId: NoteId }
  | { readonly type: 'move'; readonly noteId: NoteId; readonly folderId: FolderId | null }
  | {
      readonly type: 'tag';
      readonly noteId: NoteId;
      readonly tagId: TagId;
      readonly op: 'add' | 'remove';
    };
