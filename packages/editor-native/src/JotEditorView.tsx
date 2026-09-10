import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef, type ComponentType, type Ref } from 'react';
import type { Document } from '@jot/schema';
import type { DocumentRevision, EditorCommand, EditorEvent, NoteId } from './index.js';
import { JOT_EDITOR_VIEW_NAME } from './view-name.js';

export { JOT_EDITOR_VIEW_NAME };

type NativeEventHandler<E extends EditorEvent> = (event: { readonly nativeEvent: E }) => void;

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
};

export type JotEditorViewProps = {
  readonly documentId: NoteId;
  readonly schemaVersion: number;
  readonly revision: DocumentRevision;
  readonly canonicalDocument?: Document;
  readonly style?: unknown;
  readonly onReady?: NativeEventHandler<Extract<EditorEvent, { type: 'ready' }>>;
  readonly onCommittedTransaction?: NativeEventHandler<
    Extract<EditorEvent, { type: 'committedTransaction' }>
  >;
  readonly onSelectionChanged?: NativeEventHandler<
    Extract<EditorEvent, { type: 'selectionChanged' }>
  >;
  readonly onCompositionChanged?: NativeEventHandler<
    Extract<EditorEvent, { type: 'compositionChanged' }>
  >;
  readonly onContentSizeChanged?: NativeEventHandler<
    Extract<EditorEvent, { type: 'contentSizeChanged' }>
  >;
  readonly onRecoverableError?: NativeEventHandler<
    Extract<EditorEvent, { type: 'recoverableError' }>
  >;
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
