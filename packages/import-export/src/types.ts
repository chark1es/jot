import type { AttachmentId, ClockEvent, Document, FolderId, NoteId, TagId } from '@jot/schema';

export type ExportRequest = {
  readonly noteIds: readonly NoteId[];
};

export type ExportAttachment = {
  readonly id: AttachmentId;
  readonly originalName: string;
  readonly mimeType: string;
  readonly bytes?: Uint8Array;
  readonly path?: string;
};

export type ExportNote = {
  readonly id: NoteId;
  readonly title: string;
  readonly document: Document;
  readonly folderPlacement: FolderId | null;
  readonly tags: readonly {
    readonly id: TagId;
    readonly name: string;
  }[];
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly created: ClockEvent;
  readonly modified: ClockEvent;
  readonly attachments: readonly ExportAttachment[];
};

export type ExportFolder = {
  readonly id: FolderId;
  readonly name: string;
  readonly parentPlacement: FolderId | null;
  readonly manualPosition: string;
};

export type VaultExportInput = {
  readonly notes: readonly ExportNote[];
  readonly folders: readonly ExportFolder[];
  readonly readAttachmentPath?: (path: string) => Uint8Array;
};

export type ExportFile = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

export type ManifestAttachment = {
  readonly id: AttachmentId;
  readonly path: string;
};

export type ManifestNote = {
  readonly id: NoteId;
  readonly path: string;
  readonly attachments: readonly ManifestAttachment[];
};

export type PortableManifest = {
  readonly format: 'jot-portable-export';
  readonly version: 1;
  readonly notes: readonly ManifestNote[];
};

export type VaultExportResult = {
  readonly files: readonly ExportFile[];
  readonly manifest: PortableManifest;
};
