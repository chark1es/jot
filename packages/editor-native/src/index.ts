import type {
  AttachmentId,
  Document,
  Mark,
  NoteId,
  SchemaOperation,
  SchemaSelection,
  TransactionId,
} from '@jot/schema';

export type DocumentRevision = number & { readonly __brand: 'DocumentRevision' };

export type TransactionOrigin = 'local' | 'remote' | 'undo' | 'redo';

export type EditorTransaction = {
  readonly transactionId: TransactionId;
  readonly operations: readonly SchemaOperation[];
};

export type EditorCommand =
  | { readonly name: 'toggleBold' }
  | { readonly name: 'toggleItalic' }
  | { readonly name: 'toggleUnderline' }
  | { readonly name: 'toggleStrikethrough' }
  | { readonly name: 'toggleInlineCode' }
  | { readonly name: 'setLink'; readonly href: string; readonly title?: string }
  | { readonly name: 'unsetLink' }
  | { readonly name: 'setHeading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly name: 'setParagraph' }
  | { readonly name: 'toggleBulletList' }
  | { readonly name: 'toggleOrderedList' }
  | { readonly name: 'toggleTaskList' }
  | { readonly name: 'toggleCodeBlock' }
  | { readonly name: 'toggleBlockquote' }
  | { readonly name: 'toggleTaskItemChecked' }
  | { readonly name: 'insertHorizontalRule' }
  | { readonly name: 'insertImage'; readonly attachmentId: AttachmentId; readonly alt?: string };

export type EditorCapabilities = {
  readonly undo: boolean;
  readonly redo: boolean;
  readonly ime: boolean;
};

export type EditorSnapshot = {
  readonly canonicalDocument: Document;
  readonly revision: DocumentRevision;
};

export type EditorEvent =
  | {
      readonly type: 'ready';
      readonly capabilities: EditorCapabilities;
      readonly schemaVersion: number;
    }
  | {
      readonly type: 'committedTransaction';
      readonly transactionId: TransactionId;
      readonly baseRevision: DocumentRevision;
      readonly operations: readonly SchemaOperation[];
      readonly inverses: readonly SchemaOperation[];
      readonly selection: SchemaSelection;
    }
  | {
      readonly type: 'selectionChanged';
      readonly selection: SchemaSelection;
      readonly activeMarks: readonly Mark[];
    }
  | { readonly type: 'compositionChanged'; readonly active: boolean }
  | { readonly type: 'contentSizeChanged'; readonly height: number }
  | { readonly type: 'recoverableError'; readonly code: string; readonly context: string };

/**
 * Expo native editor contract.
 * Implementations are Swift UITextView (TextKit 2) and Kotlin EditText (Spannable).
 * No WebView. No NSRange, Spannable indices, or ProseMirror positions leak out.
 */
export interface EditorHost {
  loadDocument(
    documentId: NoteId,
    canonicalDocument: Document,
    schemaVersion: number,
    revision: DocumentRevision,
  ): Promise<void>;
  applyTransactions(
    documentId: NoteId,
    baseRevision: DocumentRevision,
    transactions: readonly EditorTransaction[],
    origin: TransactionOrigin,
  ): Promise<void>;
  dispatchCommand(command: EditorCommand): Promise<void>;
  setSelection(selection: SchemaSelection): Promise<void>;
  getDocumentSnapshot(): Promise<EditorSnapshot>;
  focus(): Promise<void>;
  blur(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export const NATIVE_EDITOR_IMPLEMENTATIONS = ['Swift UITextView', 'Kotlin EditText'] as const;

export type {
  AttachmentId,
  Document,
  Mark,
  NoteId,
  SchemaOperation,
  SchemaSelection,
  TransactionId,
};

export { applyOperations, invertOperation, invertOperations } from './apply-operations.js';
export {
  MemoryDurableIntake,
  type DurableIntake,
  type DurableIntakeRecord,
} from './durable-intake.js';
export { HeadlessEditorHost, type EditorEventListener } from './headless-host.js';
export {
  JotEditorView,
  type JotEditorNativeHandle,
  type JotEditorViewProps,
} from './JotEditorView.js';
export {
  createNativeIntakeLedger,
  listUnappliedIntake,
  markIntakeApplied,
  parseJournalPayload,
  parseSchemaOperations,
  readNativeDocumentSnapshot,
  type NativeIntakeClient,
  type NativeIntakeClientSource,
  type NativeIntakeLedger,
  type NativeIntakeRow,
} from './native-intake.js';
export { JOT_EDITOR_VIEW_NAME } from './view-name.js';
export {
  documentToLinear,
  HARD_BREAK_TEXT,
  linearToDocument,
  OBJECT_REPLACEMENT,
  type LinearBlock,
  type LinearBlockKind,
  type LinearDocument,
  type LinearInlineMark,
  type LinearMarkType,
  type LinearRun,
} from './linear.js';
