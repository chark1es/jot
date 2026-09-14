import type { Folder, Tag } from '@jot/schema';
import type { DeviceId, FolderId, NoteId, TagId } from '@jot/schema';
import type { LocalStore } from './store.js';
import type {
  AttachmentRecord,
  DiagnosticEntry,
  FolderCycleRepairEvent,
  IntakeRecord,
  NoteDocument,
  NoteListItem,
  NoteProjection,
  RestoreVersionResult,
  SearchResult,
  UndoRedoList,
  VaultSnapshot,
  VersionSnapshot,
} from './types.js';

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

function reject(method: string): Promise<never> {
  return Promise.reject(new NotImplementedError(`LocalStore.${method} is not implemented`));
}

export class NotImplementedLocalStore implements LocalStore {
  open(): Promise<void> {
    return reject('open');
  }
  close(): Promise<void> {
    return reject('close');
  }
  getDeviceId(): Promise<DeviceId> {
    return reject('getDeviceId');
  }
  commitEdit(): Promise<void> {
    return reject('commitEdit');
  }
  getNoteProjection(): Promise<NoteProjection | null> {
    return reject('getNoteProjection');
  }
  replayUnappliedIntake(): Promise<readonly IntakeRecord[]> {
    return reject('replayUnappliedIntake');
  }
  search(): Promise<SearchResult> {
    return reject('search');
  }
  createNote(): Promise<NoteId> {
    return reject('createNote');
  }
  listNotes(): Promise<readonly NoteListItem[]> {
    return reject('listNotes');
  }
  getNoteDocument(): Promise<NoteDocument | null> {
    return reject('getNoteDocument');
  }
  applyNoteCommand(): Promise<void> {
    return reject('applyNoteCommand');
  }
  pinNote(): Promise<void> {
    return reject('pinNote');
  }
  archiveNote(): Promise<void> {
    return reject('archiveNote');
  }
  trashNote(): Promise<void> {
    return reject('trashNote');
  }
  restoreNote(): Promise<void> {
    return reject('restoreNote');
  }
  moveNote(): Promise<void> {
    return reject('moveNote');
  }
  renameTitle(): Promise<void> {
    return reject('renameTitle');
  }
  createFolder(): Promise<FolderId> {
    return reject('createFolder');
  }
  listFolders(): Promise<readonly Folder[]> {
    return reject('listFolders');
  }
  renameFolder(): Promise<void> {
    return reject('renameFolder');
  }
  moveFolder(): Promise<FolderCycleRepairEvent | null> {
    return reject('moveFolder');
  }
  trashFolder(): Promise<void> {
    return reject('trashFolder');
  }
  restoreFolder(): Promise<void> {
    return reject('restoreFolder');
  }
  reorderFolder(): Promise<void> {
    return reject('reorderFolder');
  }
  createTag(): Promise<TagId> {
    return reject('createTag');
  }
  listTags(): Promise<readonly Tag[]> {
    return reject('listTags');
  }
  addTagToNote(): Promise<void> {
    return reject('addTagToNote');
  }
  removeTagFromNote(): Promise<void> {
    return reject('removeTagFromNote');
  }
  listUndoRedo(): Promise<UndoRedoList> {
    return reject('listUndoRedo');
  }
  listHistory(): ReturnType<LocalStore['listHistory']> {
    return reject('listHistory');
  }
  listAppliedTransactionIds(): ReturnType<LocalStore['listAppliedTransactionIds']> {
    return reject('listAppliedTransactionIds');
  }
  reorderNote(): Promise<void> {
    return reject('reorderNote');
  }
  deleteNotePermanently(): Promise<void> {
    return reject('deleteNotePermanently');
  }
  purgeExpiredTrash(): Promise<readonly NoteId[]> {
    return reject('purgeExpiredTrash');
  }
  saveVersion(): Promise<VersionSnapshot> {
    return reject('saveVersion');
  }
  listVersions(): Promise<readonly VersionSnapshot[]> {
    return reject('listVersions');
  }
  restoreVersion(): Promise<RestoreVersionResult> {
    return reject('restoreVersion');
  }
  considerAutomaticVersion(): Promise<VersionSnapshot | null> {
    return reject('considerAutomaticVersion');
  }
  importAttachment(): Promise<AttachmentRecord> {
    return reject('importAttachment');
  }
  listAttachments(): Promise<readonly AttachmentRecord[]> {
    return reject('listAttachments');
  }
  getAttachmentBytes(): Promise<Uint8Array | null> {
    return reject('getAttachmentBytes');
  }
  appendDiagnostic(): Promise<void> {
    return reject('appendDiagnostic');
  }
  listDiagnostics(): Promise<readonly DiagnosticEntry[]> {
    return reject('listDiagnostics');
  }
  getCrdtUpdates(): Promise<readonly Uint8Array[]> {
    return reject('getCrdtUpdates');
  }
  exportVaultSnapshot(): Promise<VaultSnapshot> {
    return reject('exportVaultSnapshot');
  }
}
