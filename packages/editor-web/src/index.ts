import type {
  Document,
  Mark,
  NoteId,
  SchemaOperation,
  SchemaSelection,
  TransactionId,
} from '@jolt/schema';

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
  | { readonly name: 'setHeading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly name: 'setParagraph' }
  | { readonly name: 'toggleBulletList' }
  | { readonly name: 'toggleOrderedList' }
  | { readonly name: 'toggleTaskList' };

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
 * Desktop EditorHost for TipTap / ProseMirror.
 * Types only in Phase 0. Do not add y-prosemirror or prosemirror dependencies yet.
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

export const WEB_EDITOR_STACK = ['TipTap', 'ProseMirror'] as const;

export type { Document, Mark, NoteId, SchemaOperation, SchemaSelection, TransactionId };
