import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef, type ComponentType, type Ref } from 'react';
import type { Document } from '@jot/schema';
import type {
  DocumentRevision,
  EditorCommand,
  EditorEvent,
  EditorHistoryEntry,
  EditorTransaction,
  NoteId,
  TransactionOrigin,
} from './index.js';
import { JOT_EDITOR_VIEW_NAME } from './view-name.js';

export { JOT_EDITOR_VIEW_NAME };

type NativeEventHandler<E extends EditorEvent> = (event: { readonly nativeEvent: E }) => void;

type EventOf<T extends EditorEvent['type']> = Extract<EditorEvent, { type: T }>;

export type JotEditorNativeHandle = {
  loadDocument: (
    documentId: NoteId,
    canonicalDocument: Document,
    schemaVersion: number,
    revision: DocumentRevision,
  ) => Promise<void>;
  dispatchCommand: (command: EditorCommand) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  focus: () => Promise<void>;
  blur: () => Promise<void>;
  listUnappliedIntake?: () => Promise<readonly unknown[]>;
  markIntakeApplied?: (transactionId: string) => Promise<void>;
  getDocumentSnapshot?: () => Promise<unknown>;
  /** Oldest first. Present on iOS builds that persist undo across launches. */
  seedHistory?: (
    undo: readonly EditorHistoryEntry[],
    redo: readonly EditorHistoryEntry[],
  ) => Promise<void>;
  /** Journal rows with these ids are already in the document passed to the next `loadDocument`. */
  setAppliedTransactionIds?: (transactionIds: readonly string[]) => Promise<void>;
  applyTransactions?: (
    documentId: NoteId,
    baseRevision: DocumentRevision,
    transactions: readonly EditorTransaction[],
    origin: TransactionOrigin,
  ) => Promise<void>;
};

export type JotEditorViewProps = {
  readonly documentId: NoteId;
  readonly schemaVersion: number;
  readonly revision: DocumentRevision;
  readonly canonicalDocument?: Document;
  /** Directory holding attachment files named by attachment id. */
  readonly attachmentsDirectory?: string;
  /** Shown while the note has no text. */
  readonly placeholder?: string;
  /** `#rrggbb` for the caret, links, and checked tasks. */
  readonly accentColor?: string;
  readonly style?: unknown;
  readonly onReady?: NativeEventHandler<EventOf<'ready'>>;
  readonly onCommittedTransaction?: NativeEventHandler<EventOf<'committedTransaction'>>;
  readonly onSelectionChanged?: NativeEventHandler<EventOf<'selectionChanged'>>;
  readonly onCompositionChanged?: NativeEventHandler<EventOf<'compositionChanged'>>;
  readonly onContentSizeChanged?: NativeEventHandler<EventOf<'contentSizeChanged'>>;
  readonly onFocusChanged?: NativeEventHandler<EventOf<'focusChanged'>>;
  readonly onImagePressed?: NativeEventHandler<EventOf<'imagePressed'>>;
  readonly onPasteRequested?: NativeEventHandler<EventOf<'pasteRequested'>>;
  readonly onRecoverableError?: NativeEventHandler<EventOf<'recoverableError'>>;
};

type NativeViewProps = JotEditorViewProps & { readonly ref?: Ref<JotEditorNativeHandle> };

function loadNativeView(): ComponentType<NativeViewProps> {
  try {
    return requireNativeViewManager(JOT_EDITOR_VIEW_NAME);
  } catch {
    return function JotEditorViewMissing(_props: NativeViewProps) {
      return null;
    };
  }
}

const NativeView = loadNativeView();

export const JotEditorView = forwardRef<JotEditorNativeHandle, JotEditorViewProps>(
  function JotEditorView(props, ref) {
    return <NativeView {...props} ref={ref} />;
  },
);
