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
import type { SearchQuery, SearchResult } from '@jot/local-store';
import type { VaultExportInput } from '@jot/import-export';
import type { Document, FolderId, NoteId, TransactionId } from '@jot/schema';
import type { CommitEditInput } from '@jot/local-store';
import { VaultSession, type VaultFolder, type VaultNote, type VaultTag } from './vault';

export type VaultStatus = 'loading' | 'ready' | 'error';

type VaultContextValue = {
  readonly status: VaultStatus;
  readonly errorMessage: string | null;
  readonly deviceId: string | null;
  readonly notes: readonly VaultNote[];
  readonly folders: readonly VaultFolder[];
  readonly tags: readonly VaultTag[];
  readonly usingMemoryFallback: boolean;
  readonly retry: () => void;
  readonly createNote: (folderId: FolderId | null) => Promise<NoteId>;
  readonly getDocument: (noteId: NoteId) => Promise<Document>;
  readonly commitEdit: (input: {
    readonly noteId: NoteId;
    readonly transactionId: TransactionId;
    readonly operations: CommitEditInput['operations'];
    readonly crdtUpdate: Uint8Array;
    readonly document: Document;
    readonly baseDocument: Document;
  }) => Promise<void>;
  readonly applyNoteCommand: (command: NoteCommand) => Promise<void>;
  readonly createFolder: (name: string, parentId: FolderId | null) => Promise<FolderId>;
  readonly renameFolder: (folderId: FolderId, name: string) => Promise<void>;
  readonly moveFolder: (folderId: FolderId, parentId: FolderId | null) => Promise<void>;
  readonly search: (query: SearchQuery) => Promise<SearchResult>;
  readonly exportForShare: () => Promise<VaultExportInput>;
  readonly ensureTag: (name: string) => VaultTag;
  readonly refresh: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'Jot could not open local notes. Try again.';
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

  const sync = useCallback((session: VaultSession) => {
    const snapshot = session.snapshot();
    setNotes(snapshot.notes);
    setFolders(snapshot.folders);
    setTags(snapshot.tags);
    setDeviceId(session.deviceId);
    setUsingMemoryFallback(session.usingMemoryFallback);
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

  const requireSession = useCallback((): VaultSession => {
    const session = sessionRef.current;
    if (session === null) {
      throw new Error('Local notes are not open yet.');
    }
    return session;
  }, []);

  const value = useMemo<VaultContextValue>(() => {
    return {
      status,
      errorMessage,
      deviceId,
      notes,
      folders,
      tags,
      usingMemoryFallback,
      retry: boot,
      createNote: async (folderId) => {
        const id = await requireSession().createNote(folderId);
        sync(requireSession());
        return id;
      },
      getDocument: (noteId) => requireSession().getDocument(noteId),
      commitEdit: async (input) => {
        await requireSession().commitEdit(input);
        sync(requireSession());
      },
      applyNoteCommand: async (command) => {
        await requireSession().applyNoteCommand(command);
        sync(requireSession());
      },
      createFolder: async (name, parentId) => {
        const id = await requireSession().createFolder(name, parentId);
        sync(requireSession());
        return id;
      },
      renameFolder: async (folderId, name) => {
        await requireSession().renameFolder(folderId, name);
        sync(requireSession());
      },
      moveFolder: async (folderId, parentId) => {
        await requireSession().moveFolder(folderId, parentId);
        sync(requireSession());
      },
      search: (query) => requireSession().search(query),
      exportForShare: () => requireSession().exportForShare(),
      ensureTag: (name) => {
        const tag = requireSession().ensureTag(name);
        sync(requireSession());
        return tag;
      },
      refresh: async () => {
        await requireSession().refreshFromStore();
        sync(requireSession());
      },
    };
  }, [
    boot,
    deviceId,
    errorMessage,
    folders,
    notes,
    requireSession,
    status,
    sync,
    tags,
    usingMemoryFallback,
  ]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (value === null) {
    throw new Error('useVault must run inside VaultProvider');
  }
  return value;
}
