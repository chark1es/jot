import {
  createId,
  INPUT_RULES,
  isAllowedHref,
  parseDocument,
  parseId,
  SCHEMA_VERSION,
  SchemaError,
  SchemaVersionError,
} from '@jot/schema';
import type {
  Document,
  InputRule,
  InsertTextOperation,
  Mark,
  NoteId,
  SchemaNode,
  SchemaOperation,
  SchemaSelection,
  TransactionId,
} from '@jot/schema';
import {
  applyOperations,
  findAncestor,
  invertOperations,
  marksAtSelection,
  selectionBlock,
  selectionOffset,
} from './apply-operations.js';
import { MemoryDurableIntake, type DurableIntake } from './durable-intake.js';
import type {
  DocumentRevision,
  EditorCommand,
  EditorEvent,
  EditorHost,
  EditorSnapshot,
  EditorTransaction,
  TransactionOrigin,
} from './index.js';
import { ancestorsOf, requireParent } from './tree.js';

export type EditorEventListener = (event: EditorEvent) => void;

type UndoEntry = {
  readonly operations: readonly SchemaOperation[];
  readonly inverses: readonly SchemaOperation[];
};

function asRevision(value: number): DocumentRevision {
  return value as DocumentRevision;
}

function emptyMarks(): Mark[] {
  return [];
}

function cloneMarks(marks: readonly Mark[]): Mark[] {
  return marks.map((mark) => ({ type: mark.type, attrs: { ...mark.attrs } }));
}

type ToggleMark = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'inlineCode';

function textOf(node: SchemaNode): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (node.type === 'hardBreak') {
    return '\n';
  }
  return node.content.map(textOf).join('');
}

function headingLevelFrom(value: string | number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6) {
    return value;
  }
  return 1;
}

function matchInputRule(text: string): InputRule | undefined {
  for (const rule of INPUT_RULES) {
    if (new RegExp(rule.pattern).test(text)) {
      return rule;
    }
  }
  return undefined;
}

function isBlocksParent(node: SchemaNode): boolean {
  return node.type === 'doc' || node.type === 'blockquote' || node.type === 'tableCell';
}

function paragraphFrom(block: SchemaNode): SchemaNode {
  return {
    type: 'paragraph',
    id: block.id,
    attrs: {},
    content:
      block.type === 'codeBlock'
        ? block.content.map((child) => ({ ...child, marks: [] }))
        : block.content,
    marks: [],
  };
}

function codeBlockFrom(block: SchemaNode): SchemaNode {
  const text = textOf(block);
  const content: SchemaNode[] =
    text.length === 0
      ? []
      : [
          {
            type: 'text',
            id: createId(),
            attrs: {},
            content: [],
            marks: [],
            text,
          },
        ];
  return {
    type: 'codeBlock',
    id: block.id,
    attrs: { languageId: '' },
    content,
    marks: [],
  };
}

function headingFrom(block: SchemaNode, level: 1 | 2 | 3 | 4 | 5 | 6): SchemaNode {
  return {
    type: 'heading',
    id: block.id,
    attrs: { level },
    content: block.content,
    marks: [],
  };
}

export class HeadlessEditorHost implements EditorHost {
  private document: Document | undefined;
  private documentId: NoteId | undefined;
  private revision = asRevision(0);
  private selection: SchemaSelection | undefined;
  private storedMarks: Mark[] = [];
  private composing = false;
  private compositionFrom: SchemaSelection | undefined;
  private compositionTo: SchemaSelection | undefined;
  private composingText = '';
  private readonly remoteQueue: EditorTransaction[] = [];
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly listeners = new Set<EditorEventListener>();

  constructor(private readonly intake: DurableIntake = new MemoryDurableIntake()) {}

  subscribe(listener: EditorEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  loadDocument(
    documentId: NoteId,
    canonicalDocument: Document,
    schemaVersion: number,
    revision: DocumentRevision,
  ): Promise<void> {
    if (schemaVersion !== SCHEMA_VERSION) {
      throw new SchemaVersionError({
        schemaVersion,
        minReader: SCHEMA_VERSION,
        minWriter: SCHEMA_VERSION,
      });
    }
    this.document = parseDocument(canonicalDocument);
    this.documentId = documentId;
    this.revision = revision;
    this.selection = undefined;
    this.storedMarks = emptyMarks();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.remoteQueue.length = 0;
    this.composing = false;
    this.emit({
      type: 'ready',
      capabilities: { undo: true, redo: true, ime: true },
      schemaVersion: SCHEMA_VERSION,
    });
    return Promise.resolve();
  }

  async applyTransactions(
    documentId: NoteId,
    baseRevision: DocumentRevision,
    transactions: readonly EditorTransaction[],
    origin: TransactionOrigin,
  ): Promise<void> {
    this.assertLoaded(documentId, baseRevision);
    if (this.composing && origin === 'remote') {
      this.remoteQueue.push(...transactions);
      return;
    }
    if (this.composing && origin === 'local') {
      for (const transaction of transactions) {
        this.noteComposing(transaction.operations);
      }
      return;
    }
    for (const transaction of transactions) {
      await this.commit(transaction.operations, origin, transaction.transactionId);
    }
  }

  async dispatchCommand(command: EditorCommand): Promise<void> {
    const doc = this.requireDocument();
    const selection = this.selection;
    if (selection === undefined) {
      return;
    }
    if (command.name === 'toggleBold') {
      this.toggleInline('bold', selection);
      return;
    }
    if (command.name === 'toggleItalic') {
      this.toggleInline('italic', selection);
      return;
    }
    if (command.name === 'toggleUnderline') {
      this.toggleInline('underline', selection);
      return;
    }
    if (command.name === 'toggleStrikethrough') {
      this.toggleInline('strikethrough', selection);
      return;
    }
    if (command.name === 'toggleInlineCode') {
      this.toggleInline('inlineCode', selection);
      return;
    }
    if (command.name === 'setLink') {
      this.setLink(command.href, command.title ?? '', selection);
      return;
    }
    if (command.name === 'unsetLink') {
      this.unsetLink(selection);
      return;
    }
    const findNode = (node: SchemaNode, id: string): SchemaNode | undefined => {
      if (node.id === id) {
        return node;
      }
      for (const child of node.content) {
        const found = findNode(child, id);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    };
    if (command.name === 'setImageWidth') {
      const image = findNode(doc, command.nodeId);
      if (image?.type !== 'image') {
        return;
      }
      const prior = image.attrs.widthBasisPoints ?? 10000;
      const next = Math.min(10000, Math.max(2000, Math.round(command.widthBasisPoints)));
      if (next === prior) {
        return;
      }
      await this.commit(
        [
          {
            type: 'setNodeAttributes',
            nodeId: image.id,
            patch: { widthBasisPoints: next },
            priorValues: { widthBasisPoints: prior },
          },
        ],
        'local',
      );
      return;
    }
    if (command.name === 'removeBlock') {
      const target = findNode(doc, command.nodeId);
      if (target === undefined || target.id === doc.id) {
        return;
      }
      await this.commit([{ type: 'deleteNode', nodeId: target.id, deletedNode: target }], 'local');
      return;
    }
    if (command.name === 'insertBlocks') {
      const top = doc.content.findIndex((child) => findNode(child, selection.nodeId) !== undefined);
      const index = top === -1 ? doc.content.length : top + 1;
      await this.commit(
        command.nodes.map((node, offset) => ({
          type: 'insertNode' as const,
          parentId: doc.id,
          index: index + offset,
          node,
        })),
        'local',
      );
      return;
    }
    const block = selectionBlock(doc, selection);
    switch (command.name) {
      case 'setHeading':
        await this.replaceBlock(block, headingFrom(block, command.level));
        return;
      case 'setParagraph':
        await this.replaceBlock(block, paragraphFrom(block));
        return;
      case 'toggleCodeBlock':
        await this.replaceBlock(
          block,
          block.type === 'codeBlock' ? paragraphFrom(block) : codeBlockFrom(block),
        );
        return;
      case 'toggleBulletList':
        await this.toggleList(block, 'bulletList');
        return;
      case 'toggleOrderedList':
        await this.toggleList(block, 'orderedList');
        return;
      case 'toggleTaskList':
        await this.toggleList(block, 'taskList');
        return;
      case 'toggleBlockquote':
        await this.toggleBlockquote(block);
        return;
      case 'insertHorizontalRule':
        await this.insertAtomic(block, {
          type: 'horizontalRule',
          id: createId(),
          attrs: {},
          content: [],
          marks: [],
        });
        return;
      case 'insertImage':
        await this.insertAtomic(block, {
          type: 'image',
          id: createId(),
          attrs: {
            attachmentId: parseId(command.attachmentId),
            widthBasisPoints: 10000,
            alt: command.alt ?? '',
          },
          content: [],
          marks: [],
        });
        return;
      case 'toggleTaskItemChecked': {
        const item = findAncestor(doc, block.id, (node) => node.type === 'taskItem');
        if (item === undefined) {
          return;
        }
        const checked = item.attrs.checked === 1 ? 0 : 1;
        await this.commit(
          [
            {
              type: 'setNodeAttributes',
              nodeId: item.id,
              patch: { checked },
              priorValues: { checked: item.attrs.checked ?? 0 },
            },
          ],
          'local',
        );
        return;
      }
    }
  }

  setSelection(selection: SchemaSelection): Promise<void> {
    const doc = this.requireDocument();
    this.selection = selection;
    this.storedMarks = cloneMarks(marksAtSelection(doc, selection));
    this.emit({ type: 'selectionChanged', selection, activeMarks: this.storedMarks });
    return Promise.resolve();
  }

  getDocumentSnapshot(): Promise<EditorSnapshot> {
    return Promise.resolve({
      canonicalDocument: parseDocument(this.requireDocument()),
      revision: this.revision,
    });
  }

  focus(): Promise<void> {
    return Promise.resolve();
  }

  blur(): Promise<void> {
    return Promise.resolve();
  }

  async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    if (entry === undefined) {
      return;
    }
    await this.commit(entry.inverses, 'undo');
    this.redoStack.push(entry);
  }

  async redo(): Promise<void> {
    const entry = this.redoStack.pop();
    if (entry === undefined) {
      return;
    }
    await this.commit(entry.operations, 'redo');
    this.undoStack.push(entry);
  }

  beginComposition(): Promise<void> {
    const selection = this.selection;
    if (selection === undefined) {
      throw new SchemaError('no-selection', 'composition requires a selection');
    }
    this.composing = true;
    this.compositionFrom = selection;
    this.compositionTo = selection;
    this.composingText = '';
    this.emit({ type: 'compositionChanged', active: true });
    return Promise.resolve();
  }

  async endComposition(commit: boolean): Promise<void> {
    const from = this.compositionFrom;
    const to = this.compositionTo;
    const text = this.composingText;
    this.composing = false;
    this.compositionFrom = undefined;
    this.compositionTo = undefined;
    this.composingText = '';
    this.emit({ type: 'compositionChanged', active: false });
    if (commit && from !== undefined && to !== undefined) {
      await this.commit(
        [
          {
            type: 'replaceRange',
            from,
            to,
            slice: {
              nodes: [
                {
                  type: 'text',
                  id: createId(),
                  attrs: {},
                  content: [],
                  marks: cloneMarks(this.storedMarks),
                  text,
                },
              ],
            },
            deletedSlice: { nodes: [] },
          },
        ],
        'local',
      );
    }
    const queued = this.remoteQueue.splice(0, this.remoteQueue.length);
    for (const transaction of queued) {
      await this.commit(transaction.operations, 'remote', transaction.transactionId);
    }
  }

  private emit(event: EditorEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private requireDocument(): Document {
    if (this.document === undefined) {
      throw new SchemaError('not-loaded', 'no document is loaded');
    }
    return this.document;
  }

  private assertLoaded(documentId: NoteId, baseRevision: DocumentRevision): void {
    if (this.document === undefined || this.documentId === undefined) {
      throw new SchemaError('not-loaded', 'no document is loaded');
    }
    if (this.documentId !== documentId) {
      throw new SchemaError('document-mismatch', 'transaction targets a different note');
    }
    if (this.revision !== baseRevision) {
      throw new SchemaError('revision-mismatch', 'transaction base revision does not match');
    }
  }

  private noteComposing(operations: readonly SchemaOperation[]): void {
    for (const operation of operations) {
      if (operation.type === 'insertText') {
        this.composingText += operation.text;
      } else if (operation.type === 'replaceRange') {
        this.composingText = operation.slice.nodes.map((node) => textOf(node)).join('');
      }
    }
  }

  private toggleInline(type: ToggleMark, selection: SchemaSelection): void {
    const has = this.storedMarks.some((mark) => mark.type === type);
    this.storedMarks = has
      ? this.storedMarks.filter((mark) => mark.type !== type)
      : [...this.storedMarks, { type, attrs: {} }];
    this.emit({ type: 'selectionChanged', selection, activeMarks: this.storedMarks });
  }

  private setLink(href: string, title: string, selection: SchemaSelection): void {
    if (!isAllowedHref(href)) {
      throw new SchemaError('invalid-url', 'link href scheme is not allowed');
    }
    const mark: Mark = { type: 'link', attrs: { href, title } };
    this.storedMarks = [...this.storedMarks.filter((item) => item.type !== 'link'), mark];
    this.emit({ type: 'selectionChanged', selection, activeMarks: this.storedMarks });
  }

  private unsetLink(selection: SchemaSelection): void {
    this.storedMarks = this.storedMarks.filter((mark) => mark.type !== 'link');
    this.emit({ type: 'selectionChanged', selection, activeMarks: this.storedMarks });
  }

  private nearestBlocksChild(doc: Document, nodeId: SchemaNode['id']): {
    parent: SchemaNode;
    index: number;
    block: SchemaNode;
  } {
    const path = ancestorsOf(doc, nodeId);
    for (const [index, node] of path.entries()) {
      const parent = path[index + 1];
      if (parent === undefined || !isBlocksParent(parent)) {
        continue;
      }
      const loc = requireParent(doc, node.id);
      return { parent: loc.parent, index: loc.index, block: node };
    }
    throw new SchemaError('invalid-position', 'no blocks parent');
  }

  private async toggleBlockquote(block: SchemaNode): Promise<void> {
    const doc = this.requireDocument();
    const quote = findAncestor(doc, block.id, (node) => node.type === 'blockquote');
    if (quote !== undefined) {
      const loc = requireParent(doc, quote.id);
      const ops: SchemaOperation[] = [{ type: 'deleteNode', nodeId: quote.id, deletedNode: quote }];
      for (const [offset, child] of quote.content.entries()) {
        ops.push({
          type: 'insertNode',
          parentId: loc.parent.id,
          index: loc.index + offset,
          node: child,
        });
      }
      await this.commit(ops, 'local');
      return;
    }
    const target = this.nearestBlocksChild(doc, block.id);
    const wrapped: SchemaNode = {
      type: 'blockquote',
      id: createId(),
      attrs: {},
      content: [target.block],
      marks: [],
    };
    await this.commit(
      [
        { type: 'deleteNode', nodeId: target.block.id, deletedNode: target.block },
        { type: 'insertNode', parentId: target.parent.id, index: target.index, node: wrapped },
      ],
      'local',
    );
  }

  private async insertAtomic(block: SchemaNode, node: SchemaNode): Promise<void> {
    const doc = this.requireDocument();
    const target = this.nearestBlocksChild(doc, block.id);
    await this.commit(
      [
        {
          type: 'insertNode',
          parentId: target.parent.id,
          index: target.index + 1,
          node,
        },
      ],
      'local',
    );
  }

  private inputRuleOperations(op: InsertTextOperation): readonly SchemaOperation[] | undefined {
    if (op.text !== ' ' && op.text !== '\n') {
      return undefined;
    }
    const doc = this.requireDocument();
    const block = selectionBlock(doc, op.position);
    if (block.type !== 'paragraph') {
      return undefined;
    }
    const offset = selectionOffset(doc, op.position);
    const text = textOf(block);
    if (offset !== text.length) {
      return undefined;
    }
    const rule = matchInputRule(text);
    if (rule === undefined) {
      return undefined;
    }
    const converted = this.inputRuleNode(block, rule);
    if (converted === undefined) {
      return undefined;
    }
    const loc = requireParent(doc, block.id);
    return [
      { type: 'deleteNode', nodeId: block.id, deletedNode: block },
      { type: 'insertNode', parentId: loc.parent.id, index: loc.index, node: converted },
    ];
  }

  private inputRuleNode(block: SchemaNode, rule: InputRule): SchemaNode | undefined {
    const cleared: SchemaNode = { ...block, content: [] };
    switch (rule.nodeType) {
      case 'heading':
        return headingFrom(cleared, headingLevelFrom(rule.attrs?.level));
      case 'codeBlock':
        return codeBlockFrom(cleared);
      case 'blockquote':
        return {
          type: 'blockquote',
          id: createId(),
          attrs: {},
          content: [cleared],
          marks: [],
        };
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return this.listWrapping(cleared, rule.nodeType, rule.attrs?.checked === 1 ? 1 : 0);
      default:
        return undefined;
    }
  }

  private listWrapping(
    block: SchemaNode,
    listType: 'bulletList' | 'orderedList' | 'taskList',
    checked: 0 | 1,
  ): SchemaNode {
    const itemType = listType === 'taskList' ? 'taskItem' : 'listItem';
    return {
      type: listType,
      id: createId(),
      attrs: listType === 'orderedList' ? { start: 1 } : {},
      content: [
        {
          type: itemType,
          id: createId(),
          attrs: itemType === 'taskItem' ? { checked } : {},
          content: [block],
          marks: [],
        },
      ],
      marks: [],
    };
  }

  private async replaceBlock(block: SchemaNode, next: SchemaNode): Promise<void> {
    const doc = this.requireDocument();
    const loc = requireParent(doc, block.id);
    await this.commit(
      [
        { type: 'deleteNode', nodeId: block.id, deletedNode: block },
        { type: 'insertNode', parentId: loc.parent.id, index: loc.index, node: next },
      ],
      'local',
    );
  }

  private async toggleList(
    block: SchemaNode,
    listType: 'bulletList' | 'orderedList' | 'taskList',
  ): Promise<void> {
    const doc = this.requireDocument();
    const item = findAncestor(
      doc,
      block.id,
      (node) => node.type === 'listItem' || node.type === 'taskItem',
    );
    const list =
      item === undefined ? undefined : findAncestor(doc, item.id, (node) => node.type === listType);
    if (item !== undefined && list !== undefined) {
      const listLoc = requireParent(doc, list.id);
      if (list.content.length === 1) {
        await this.commit(
          [
            { type: 'deleteNode', nodeId: list.id, deletedNode: list },
            { type: 'insertNode', parentId: listLoc.parent.id, index: listLoc.index, node: block },
          ],
          'local',
        );
        return;
      }
      const itemLoc = requireParent(doc, item.id);
      await this.commit(
        [
          { type: 'deleteNode', nodeId: item.id, deletedNode: item },
          {
            type: 'insertNode',
            parentId: listLoc.parent.id,
            index: listLoc.index + (itemLoc.index === 0 ? 0 : 1),
            node: block,
          },
        ],
        'local',
      );
      return;
    }
    const loc = requireParent(doc, block.id);
    const itemType = listType === 'taskList' ? 'taskItem' : 'listItem';
    const listNode: SchemaNode = {
      type: listType,
      id: createId(),
      attrs: listType === 'orderedList' ? { start: 1 } : {},
      content: [
        {
          type: itemType,
          id: createId(),
          attrs: itemType === 'taskItem' ? { checked: 0 } : {},
          content: [block],
          marks: [],
        },
      ],
      marks: [],
    };
    await this.commit(
      [
        { type: 'deleteNode', nodeId: block.id, deletedNode: block },
        { type: 'insertNode', parentId: loc.parent.id, index: loc.index, node: listNode },
      ],
      'local',
    );
  }

  private async commit(
    operations: readonly SchemaOperation[],
    origin: TransactionOrigin,
    transactionId: TransactionId = createId<TransactionId>(),
  ): Promise<void> {
    const documentId = this.documentId;
    if (documentId === undefined) {
      throw new SchemaError('not-loaded', 'no document is loaded');
    }
    const before = this.requireDocument();
    let applied = operations;
    if (origin === 'local' && operations.length === 1) {
      const first = operations[0];
      if (first?.type === 'insertText') {
        applied = this.inputRuleOperations(first) ?? operations;
      }
    }
    const inverses = invertOperations(before, applied);
    const next = applyOperations(before, applied);
    const baseRevision = this.revision;
    await this.intake.append({
      id: transactionId,
      documentId,
      baseRevision,
      operations: applied,
      inverses,
      origin,
    });
    this.document = next;
    this.revision = asRevision(this.revision + 1);
    if (origin === 'local') {
      this.undoStack.push({ operations: applied, inverses });
      this.redoStack.length = 0;
    }
    await this.intake.markApplied(transactionId);
    this.emit({
      type: 'committedTransaction',
      transactionId,
      baseRevision,
      operations: applied,
      inverses,
      selection: this.selection ?? {
        nodeId: next.id,
        offsetUtf16: 0,
        affinity: 'after',
        revision: this.revision,
      },
    });
  }
}
