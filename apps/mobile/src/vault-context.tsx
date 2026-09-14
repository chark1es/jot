import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { NoteCommand } from '@jot/core';
import type {
  DiagnosticEntry,
  NoteHistory,
  SearchQuery,
  SearchResult,
  VersionSnapshot,
} from '@jot/local-store';
import type { VaultExportInput } from '@jot/import-export';
import type { Document, FolderId, NoteId, TagId, TransactionId } from '@jot/schema';
import {
  VaultSession,
  type CommitRequest,
  type ImageAsset,
  type ImportedImage,
  type VaultFolder,
  type VaultNote,
  type VaultTag,
} from './vault';

export type VaultStatus = 'loading' | 'ready' | 'error';

type VaultContextValue = {
  readonly status: VaultStatus;
  readonly errorMessage: string | null;
  readonly deviceId: string | null;
  readonly notes: readonly VaultNote[];
  readonly folders: readonly VaultFolder[];
  readonly tags: readonly VaultTag[];
  readonly usingMemoryFallback: boolean;
  /** `file://` URI of the folder holding attachment files, once notes are open. */
  readonly attachmentsDirectory: string | null;
  readonly retry: () => void;
  readonly refresh: () => Promise<void>;
  readonly createNote: (folderId: FolderId | null) => Promise<NoteId>;
  readonly getDocument: (noteId: NoteId) => Promise<Document>;
  readonly commitEdit: (input: CommitRequest) => Promise<void>;
  readonly applyNoteCommand: (command: NoteCommand) => Promise<void>;
  readonly reorderNotes: (ordered: readonly NoteId[]) => Promise<void>;
  readonly deleteNotePermanently: (noteId: NoteId) => Promise<void>;
  readonly emptyTrash: () => Promise<number>;
  readonly createTag: (name: string) => Promise<VaultTag>;
  readonly setNoteTag: (noteId: NoteId, tagId: TagId, attached: boolean) => Promise<void>;
  readonly listHistory: (noteId: NoteId) => Promise<NoteHistory>;
  readonly listAppliedTransactionIds: (noteId: NoteId) => Promise<readonly TransactionId[]>;
  readonly listVersions: (noteId: NoteId) => Promise<readonly VersionSnapshot[]>;
  readonly saveVersion: (noteId: NoteId) => Promise<void>;
  readonly versionDocument: (noteId: NoteId, versionId: TransactionId) => Promise<Document>;
  readonly importImage: (noteId: NoteId, asset: ImageAsset) => Promise<ImportedImage>;
  readonly createFolder: (name: string, parentId: FolderId | null) => Promise<FolderId>;
  readonly renameFolder: (folderId: FolderId, name: string) => Promise<void>;
  readonly moveFolder: (folderId: FolderId, parentId: FolderId | null) => Promise<void>;
  readonly deleteFolder: (folderId: FolderId) => Promise<void>;
  readonly search: (query: SearchQuery) => Promise<SearchResult>;
  readonly exportForShare: () => Promise<VaultExportInput>;
  readonly listDiagnostics: (limit: number) => Promise<readonly DiagnosticEntry[]>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'Jot could not open notes on this device. Try again.';
}

export function VaultProvider({ children }: { readonly children: ReactNode }) {
  const sessionRef = useRef<VaultSession | null>(null);
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<readonly VaultNote[]>([]);
  const [folders, setFolders] = useState<readonly VaultFolder[]>([]);
  const [tags, setTags] = useState<readonly VaultTag[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [usingMemoryFallback, setUsingMemoryFallback] = useState(true);
  const [attachmentsDirectory, setAttachmentsDirectory] = useState<string | null>(null);

  const sync = useCallback((session: VaultSession) => {
    const snapshot = session.snapshot();
    setNotes(snapshot.notes);
    setFolders(snapshot.folders);
    setTags(snapshot.tags);
    setDeviceId(session.deviceId);
    setUsingMemoryFallback(session.usingMemoryFallback);
    setAttachmentsDirectory(session.attachmentsDirectory);
  }, []);

  const boot = useCallback(() => {
    setStatus('loading');
    setErrorMessage(null);
    void (async () => {
      try {
        const session = await VaultSession.open();
        sessionRef.current = session;
        sync(session);
        setStatus('ready');
      } catch (error) {
        sessionRef.current = null;
        setStatus('error');
        setErrorMessage(errorText(error));
      }
    })();
  }, [sync]);

  useEffect(() => {
    boot();
  }, [boot]);

  const value = useMemo<VaultContextValue>(() => {
    const requireSession = (): VaultSession => {
      const session = sessionRef.current;
      if (session === null) {
        throw new Error('Notes are still opening.');
      }
      return session;
    };
    /** Runs a vault change and publishes the updated lists, even when the change fails. */
    const mutate = async <T,>(run: (session: VaultSession) => Promise<T>): Promise<T> => {
      const session = requireSession();
      try {
        return await run(session);
      } finally {
        sync(session);
      }
    };
    return {
      status,
      errorMessage,
      deviceId,
      notes,
      folders,
      tags,
      usingMemoryFallback,
      attachmentsDirectory,
      retry: boot,
      refresh: () => mutate((session) => session.refreshFromStore()),
      createNote: (folderId) => mutate((session) => session.createNote(folderId)),
      getDocument: (noteId) => requireSession().getDocument(noteId),
      commitEdit: (input) => mutate((session) => session.commitEdit(input)),
      applyNoteCommand: (command) => mutate((session) => session.applyNoteCommand(command)),
      reorderNotes: (ordered) => mutate((session) => session.reorderNotes(ordered)),
      deleteNotePermanently: (noteId) => mutate((session) => session.deleteNotePermanently(noteId)),
      emptyTrash: () => mutate((session) => session.emptyTrash()),
      createTag: (name) => mutate((session) => session.createTag(name)),
      setNoteTag: (noteId, tagId, attached) => mutate((session) => session.setNoteTag(noteId, tagId, attached)),
      listHistory: (noteId) => requireSession().listHistory(noteId),
      listAppliedTransactionIds: (noteId) => requireSession().listAppliedTransactionIds(noteId),
      listVersions: (noteId) => requireSession().listVersions(noteId),
      saveVersion: (noteId) => requireSession().saveVersion(noteId),
      versionDocument: (noteId, versionId) => requireSession().versionDocument(noteId, versionId),
      importImage: (noteId, asset) => requireSession().importImage(noteId, asset),
      createFolder: (name, parentId) => mutate((session) => session.createFolder(name, parentId)),
      renameFolder: (folderId, name) => mutate((session) => session.renameFolder(folderId, name)),
      moveFolder: (folderId, parentId) => mutate((session) => session.moveFolder(folderId, parentId)),
      deleteFolder: (folderId) => mutate((session) => session.deleteFolder(folderId)),
      search: (query) => requireSession().search(query),
      exportForShare: () => requireSession().exportForShare(),
      listDiagnostics: (limit) => requireSession().listDiagnostics(limit),
    };
  }, [attachmentsDirectory, boot, deviceId, errorMessage, folders, notes, status, sync, tags, usingMemoryFallback]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (value === null) {
    throw new Error('useVault must run inside VaultProvider');
  }
  return value;
}
