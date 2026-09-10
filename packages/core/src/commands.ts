import type { FolderId, NoteId, TagId } from '@jot/schema';

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

export type FolderCommand =
  | {
      readonly type: 'create';
      readonly folderId: FolderId;
      readonly name: string;
      readonly parentPlacement: FolderId | null;
    }
  | { readonly type: 'rename'; readonly folderId: FolderId; readonly name: string }
  | { readonly type: 'move'; readonly folderId: FolderId; readonly parentPlacement: FolderId | null }
  | { readonly type: 'trash'; readonly folderId: FolderId }
  | { readonly type: 'restore'; readonly folderId: FolderId }
  | { readonly type: 'reorder'; readonly folderId: FolderId; readonly manualPosition: string };

export type TagCommand =
  | { readonly type: 'create'; readonly tagId: TagId; readonly name: string; readonly colorRole: string | null }
  | { readonly type: 'addToNote'; readonly noteId: NoteId; readonly tagId: TagId }
  | { readonly type: 'removeFromNote'; readonly noteId: NoteId; readonly tagId: TagId };
