import type {
  AttrValue,
  Document,
  Mark,
  NodeId,
  SchemaNode,
  SchemaOperation,
  SchemaSelection,
  TransactionId,
} from '@jot/schema';
import {
  deriveId,
  isMarkType,
  isNodeType,
  MARK_SPECS,
  NODE_SPECS,
  parseDocument,
  parseId,
  SCHEMA_VERSION,
} from '@jot/schema';
import type { AttrSpec, NodeType } from '@jot/schema';
import * as Y from 'yjs';
import type { CrdtDocument } from './crdt.js';

const TITLE_KEY = 'title';
const BODY_KEY = 'body';
const METADATA_KEY = 'metadata';
const ATTACHMENT_REFS_KEY = 'attachmentRefs';
const META_KEY = 'meta';
const DOC_ID_KEY = 'docId';
const SCHEMA_VERSION_KEY = 'schemaVersion';
const FALLBACK_DOC_ID = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');

/** Phase 1 marks mapped to Yjs attributes. textColor/highlight stay unsupported. */
export const PHASE1_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'inlineCode',
  'link',
] as const;

const PHASE1_MARK_SET = new Set<string>(PHASE1_MARK_TYPES);

type XmlChild = Y.XmlElement | Y.XmlText;
type XmlParent = Y.XmlFragment;

export class CrdtApplyError extends Error {
  override readonly name = 'CrdtApplyError';
}

/**
 * Yjs 13 behind CrdtDocument. One Y.Doc per note:
 *   title: Y.Text
 *   body: Y.XmlFragment
 *   metadata: Y.Map (empty ok in Phase 0.5)
 *   attachmentRefs: Y.Map
 *   schemaVersion + docId: entries on Y.Map `meta`
 *
 * Schema blocks/inlines map to Y.XmlElement, text to Y.XmlText, Phase 1 marks
 * (bold, italic, underline, strikethrough, inlineCode, link) to Yjs formatting
 * attributes. textColor and highlight stay unmapped until a later phase.
 * Canonical document stays authoritative: every projection runs parseDocument.
 *
 * IME must not enter this class until the native editor commits. Intermediate
 * candidates are native-only.
 *
 * Duplicate transactionId suppression uses a JS Set on this wrapper. That is
 * local Phase 0.5 behavior. The sync ledger is later and is not this Set.
 */
export class YjsCrdtDocument implements CrdtDocument {
  private readonly doc: Y.Doc;
  private readonly title: Y.Text;
  private readonly body: Y.XmlFragment;
  private readonly meta: Y.Map<unknown>;
  private readonly appliedTransactionIds = new Set<string>();

  constructor() {
    this.doc = new Y.Doc();
    this.title = this.doc.getText(TITLE_KEY);
    this.body = this.doc.getXmlFragment(BODY_KEY);
    this.doc.getMap(METADATA_KEY);
    this.doc.getMap(ATTACHMENT_REFS_KEY);
    this.meta = this.doc.getMap(META_KEY);
  }

  static fromCanonical(document: Document, title = ''): YjsCrdtDocument {
    const instance = new YjsCrdtDocument();
    instance.replaceFromCanonical(document, title);
    return instance;
  }

  replaceFromCanonical(document: Document, title = ''): void {
    this.doc.transact(() => {
      this.meta.set(DOC_ID_KEY, document.id);
      this.meta.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
      if (this.body.length > 0) {
        this.body.delete(0, this.body.length);
      }
      const children = document.content.map((node) => schemaNodeToXml(node));
      if (children.length > 0) {
        this.body.insert(0, children);
      }
      if (this.title.length > 0) {
        this.title.delete(0, this.title.length);
      }
      if (title.length > 0) {
        this.title.insert(0, title);
      }
    });
  }

  applyUpdate(bytes: Uint8Array): void {
    Y.applyUpdate(this.doc, bytes);
  }

  encodeUpdate(since?: Uint8Array): Uint8Array {
    if (since === undefined) {
      return Y.encodeStateAsUpdate(this.doc);
    }
    return Y.encodeStateAsUpdate(this.doc, since);
  }

  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  getTitle(): string {
    return this.title.toJSON();
  }

  insertTitleText(index: number, text: string): void {
    this.title.insert(index, text);
  }

  getCanonicalDocument(): Document {
    const docId = this.readDocId();
    const content = xmlChildrenToSchema(docId, this.body.toArray());
    return parseDocument({
      type: 'doc',
      id: docId,
      content,
    });
  }

  applySchemaOperations(ops: readonly SchemaOperation[], transactionId: TransactionId): void {
    if (this.appliedTransactionIds.has(transactionId)) {
      return;
    }
    this.doc.transact(() => {
      for (const op of ops) {
        this.applyOp(op);
      }
    }, transactionId);
    this.appliedTransactionIds.add(transactionId);
    parseDocument(this.getCanonicalDocument());
  }

  private readDocId(): NodeId {
    const value = this.meta.get(DOC_ID_KEY);
    if (typeof value === 'string') {
      return parseId(value);
    }
    return FALLBACK_DOC_ID;
  }

  private applyOp(op: SchemaOperation): void {
    switch (op.type) {
      case 'insertText':
        this.insertText(op.position, op.text, op.storedMarks);
        return;
      case 'deleteRange':
        this.deleteRange(op.from, op.to);
        return;
      case 'replaceRange':
        this.deleteRange(op.from, op.to);
        this.insertSlice(op.from, op.slice.nodes);
        return;
      case 'addMark':
        this.formatRange(op.range.from, op.range.to, formatAddMark(op.mark));
        return;
      case 'removeMark':
        this.formatRange(op.range.from, op.range.to, { [op.markType]: null });
        return;
      case 'setNodeAttributes':
        this.setNodeAttributes(op.nodeId, op.patch);
        return;
      case 'insertNode':
        this.insertNode(op.parentId, op.index, op.node);
        return;
      case 'deleteNode':
        this.deleteNode(op.nodeId);
        return;
    }
  }

  private insertText(position: SchemaSelection, text: string, storedMarks: readonly Mark[]): void {
    if (text.length === 0) {
      return;
    }
    const anchor = this.locateInsert(position);
    const assoc = position.affinity === 'before' ? -1 : 0;
    const relative = Y.createRelativePositionFromTypeIndex(anchor.text, anchor.index, assoc);
    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, this.doc);
    const index = absolute === null ? anchor.index : absolute.index;
    anchor.text.insert(index, text, formatFromMarks(storedMarks));
  }

  private deleteRange(from: SchemaSelection, to: SchemaSelection): void {
    const start = this.locate(from);
    const end = this.locate(to);
    if (start.text === end.text) {
      const lo = Math.min(start.index, end.index);
      const hi = Math.max(start.index, end.index);
      if (hi > lo) {
        start.text.delete(lo, hi - lo);
      }
      return;
    }
    const fromBlock = asXmlElement(start.text.parent);
    const toBlock = asXmlElement(end.text.parent);
    if (fromBlock !== null && toBlock !== null && fromBlock !== toBlock) {
      // Across text blocks the schema defines one edit, joining adjacent list items, and
      // apply-operations rejects anything else. Matching it keeps the CRDT and the store equal.
      if (offsetWithin(fromBlock, start) !== blockLength(fromBlock) || offsetWithin(toBlock, end) !== 0) {
        throw new CrdtApplyError('deleteRange across unrelated blocks is not supported');
      }
      this.joinListItems(fromBlock, toBlock);
      return;
    }
    const texts = xmlTextsInOrder(this.body);
    const startPos = texts.indexOf(start.text);
    const endPos = texts.indexOf(end.text);
    if (startPos < 0 || endPos < 0) {
      throw new CrdtApplyError('deleteRange could not resolve XmlText nodes');
    }
    const loPos = Math.min(startPos, endPos);
    const hiPos = Math.max(startPos, endPos);
    const loIndex = startPos <= endPos ? start.index : end.index;
    const hiIndex = startPos <= endPos ? end.index : start.index;
    const hiText = texts[hiPos];
    const loText = texts[loPos];
    if (hiText === undefined || loText === undefined) {
      throw new CrdtApplyError('deleteRange missing XmlText');
    }
    if (hiText.length - hiIndex > 0) {
      hiText.delete(hiIndex, hiText.length - hiIndex);
    }
    for (let i = hiPos - 1; i > loPos; i -= 1) {
      const mid = texts[i];
      if (mid !== undefined && mid.length > 0) {
        mid.delete(0, mid.length);
      }
    }
    if (loText.length - loIndex > 0) {
      loText.delete(loIndex, loText.length - loIndex);
    }
  }

  /** Moves the second item's paragraph text and remaining children into the first item, then removes it. */
  private joinListItems(fromBlock: Y.XmlElement, toBlock: Y.XmlElement): void {
    const fromItem = asXmlElement(fromBlock.parent);
    const toItem = asXmlElement(toBlock.parent);
    if (fromItem === null || toItem === null || !isListItem(fromItem) || !isListItem(toItem)) {
      throw new CrdtApplyError('list join requires two list items');
    }
    const list = asXmlElement(fromItem.parent);
    const items = list === null ? [] : list.toArray();
    const fromIndex = items.indexOf(fromItem);
    if (list === null || toItem.parent !== list || items.indexOf(toItem) !== fromIndex + 1) {
      throw new CrdtApplyError('list join requires adjacent items');
    }
    for (const child of xmlChildren(toBlock)) {
      const last = fromBlock.length > 0 ? fromBlock.get(fromBlock.length - 1) : null;
      if (child instanceof Y.XmlText && last instanceof Y.XmlText) {
        // One text node, as apply-operations merges it. Every mark is spelled out so the
        // appended text does not inherit formatting from the text before it.
        for (const run of xmlTextToRuns(child)) {
          last.insert(last.length, run.insert, formatFromMarks(marksFromFormat(run.attributes)));
        }
        continue;
      }
      fromBlock.insert(fromBlock.length, [child.clone()]);
    }
    const rest = xmlChildren(toItem)
      .filter((child) => child !== toBlock)
      .map((child) => child.clone());
    if (rest.length > 0) {
      fromItem.insert(fromItem.length, rest);
    }
    list.delete(fromIndex + 1, 1);
  }

  private insertSlice(position: SchemaSelection, nodes: readonly SchemaNode[]): void {
    if (nodes.length === 0) {
      return;
    }
    const onlyText = nodes.every((node) => node.type === 'text');
    if (onlyText) {
      for (const node of nodes) {
        this.insertText(position, node.text ?? '', node.marks);
        position = {
          ...position,
          offsetUtf16: position.offsetUtf16 + (node.text ?? '').length,
        };
      }
      return;
    }
    const parent = this.findParentOf(position.nodeId) ?? this.body;
    const index = this.childIndexOf(parent, position.nodeId) + 1;
    const xml = nodes.map((node) => schemaNodeToXml(node));
    parent.insert(index, xml);
  }

  private formatRange(
    from: SchemaSelection,
    to: SchemaSelection,
    attributes: Record<string, unknown>,
  ): void {
    const start = this.locate(from);
    const end = this.locate(to);
    if (start.text !== end.text) {
      throw new CrdtApplyError('addMark/removeMark across XmlText nodes is not supported in Phase 0.5');
    }
    const lo = Math.min(start.index, end.index);
    const hi = Math.max(start.index, end.index);
    if (hi > lo) {
      start.text.format(lo, hi - lo, attributes);
    }
  }

  private setNodeAttributes(nodeId: NodeId, patch: Readonly<Record<string, AttrValue>>): void {
    const element = this.findElement(nodeId);
    if (element === null) {
      throw new CrdtApplyError(`setNodeAttributes: missing node ${nodeId}`);
    }
    for (const [key, value] of Object.entries(patch)) {
      element.setAttribute(key, String(value));
    }
  }

  private insertNode(parentId: NodeId, index: number, node: SchemaNode): void {
    const parent = this.findParentContainer(parentId);
    const xml = schemaNodeToXml(node);
    const clamped = Math.max(0, Math.min(index, parent.length));
    parent.insert(clamped, [xml]);
  }

  private deleteNode(nodeId: NodeId): void {
    const element = this.findElement(nodeId);
    if (element === null) {
      return;
    }
    const parent = element.parent;
    if (!(parent instanceof Y.XmlFragment)) {
      return;
    }
    const children = parent.toArray();
    const index = children.indexOf(element);
    if (index >= 0) {
      parent.delete(index, 1);
    }
  }

  /**
   * A caret on a list or task item means its first paragraph, the same rule
   * `apply-operations` uses. Writing into the item element itself would add a second paragraph.
   */
  private textContainer(element: Y.XmlElement): Y.XmlElement {
    if (element.nodeName !== 'listItem' && element.nodeName !== 'taskItem') {
      return element;
    }
    const paragraph = xmlChildren(element).find(
      (child): child is Y.XmlElement => child instanceof Y.XmlElement && child.nodeName === 'paragraph',
    );
    if (paragraph !== undefined) {
      return paragraph;
    }
    const created = new Y.XmlElement('paragraph');
    created.setAttribute('id', deriveId(String(element.getAttribute('id')), 'paragraph', 0));
    element.insert(0, [created]);
    return created;
  }

  private locateInsert(position: SchemaSelection): { text: Y.XmlText; index: number } {
    const element = this.findElement(position.nodeId);
    if (element !== null) {
      return this.ensureTextAt(this.textContainer(element), position.offsetUtf16);
    }
    const existing = this.locateTextRun(position.nodeId, position.offsetUtf16);
    if (existing !== null) {
      return existing;
    }
    const created = this.materializeMissingParagraph(position.nodeId);
    if (created !== null) {
      return this.ensureTextAt(created, position.offsetUtf16);
    }
    throw new CrdtApplyError(`insertText: missing node ${position.nodeId}`);
  }

  private locate(position: SchemaSelection): { text: Y.XmlText; index: number } {
    const element = this.findElement(position.nodeId);
    if (element !== null) {
      return this.offsetInElement(this.textContainer(element), position.offsetUtf16);
    }
    const run = this.locateTextRun(position.nodeId, position.offsetUtf16);
    if (run !== null) {
      return run;
    }
    const created = this.materializeMissingParagraph(position.nodeId);
    if (created !== null) {
      return this.offsetInElement(created, position.offsetUtf16);
    }
    throw new CrdtApplyError(`position not found: ${position.nodeId}`);
  }

  private materializeMissingParagraph(nodeId: NodeId): Y.XmlElement | null {
    const docId = this.readDocId();
    if (nodeId === docId) {
      const first = this.body.get(0);
      if (first instanceof Y.XmlElement) {
        return first;
      }
    }
    const paragraphId = nodeId === docId ? deriveId(docId, 'paragraph', 0) : nodeId;
    const existing = this.findElement(paragraphId);
    if (existing !== null) {
      return existing;
    }
    if (this.body.length > 0) {
      return null;
    }
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.setAttribute('id', paragraphId);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    this.body.insert(0, [paragraph]);
    return paragraph;
  }

  private ensureTextAt(element: Y.XmlElement, offset: number): { text: Y.XmlText; index: number } {
    const children = xmlChildren(element);
    if (children.length === 0) {
      const text = new Y.XmlText();
      element.insert(0, [text]);
      return { text, index: 0 };
    }
    return this.offsetInElement(element, offset);
  }

  private offsetInElement(element: Y.XmlElement, offset: number): { text: Y.XmlText; index: number } {
    let remaining = offset;
    const children = xmlChildren(element);
    for (const child of children) {
      if (child instanceof Y.XmlText) {
        if (remaining <= child.length) {
          return { text: child, index: remaining };
        }
        remaining -= child.length;
        continue;
      }
      if (child.nodeName === 'hardBreak') {
        if (remaining === 0) {
          const created = new Y.XmlText();
          const parent = child.parent;
          if (parent instanceof Y.XmlFragment) {
            const idx = parent.toArray().indexOf(child);
            parent.insert(Math.max(0, idx), [created]);
          }
          return { text: created, index: 0 };
        }
        remaining -= 1;
      }
    }
    const last = lastXmlText(children);
    if (last !== null) {
      return { text: last, index: last.length };
    }
    const created = new Y.XmlText();
    element.insert(element.length, [created]);
    return { text: created, index: 0 };
  }

  private locateTextRun(nodeId: NodeId, offset: number): { text: Y.XmlText; index: number } | null {
    const walk = (parentId: NodeId, parent: XmlParent): { text: Y.XmlText; index: number } | null => {
      let textIndex = 0;
      for (const child of xmlChildren(parent)) {
        if (child instanceof Y.XmlText) {
          const runs = xmlTextToRuns(child);
          let runOffset = 0;
          for (const run of runs) {
            const id = deriveId(parentId, 'text', textIndex);
            if (id === nodeId) {
              const clamped = Math.max(0, Math.min(offset, run.insert.length));
              return { text: child, index: runOffset + clamped };
            }
            runOffset += run.insert.length;
            textIndex += 1;
          }
          if (runs.length === 0) {
            const id = deriveId(parentId, 'text', textIndex);
            if (id === nodeId) {
              return { text: child, index: 0 };
            }
            textIndex += 1;
          }
          continue;
        }
        const childId = readElementId(child, parentId, child.nodeName);
        const nested = walk(childId, child);
        if (nested !== null) {
          return nested;
        }
      }
      return null;
    };
    return walk(this.readDocId(), this.body);
  }

  private findElement(nodeId: NodeId): Y.XmlElement | null {
    const walk = (parent: XmlParent): Y.XmlElement | null => {
      for (const child of xmlChildren(parent)) {
        if (!(child instanceof Y.XmlElement)) {
          continue;
        }
        if (child.getAttribute('id') === nodeId) {
          return child;
        }
        const nested = walk(child);
        if (nested !== null) {
          return nested;
        }
      }
      return null;
    };
    if (nodeId === this.readDocId()) {
      return null;
    }
    return walk(this.body);
  }

  private findParentContainer(parentId: NodeId): XmlParent {
    if (parentId === this.readDocId()) {
      return this.body;
    }
    const element = this.findElement(parentId);
    if (element === null) {
      throw new CrdtApplyError(`insertNode: missing parent ${parentId}`);
    }
    return element;
  }

  private findParentOf(nodeId: NodeId): XmlParent | null {
    const element = this.findElement(nodeId);
    if (element === null) {
      return null;
    }
    const parent = element.parent;
    return parent instanceof Y.XmlFragment ? parent : null;
  }

  private childIndexOf(parent: XmlParent, nodeId: NodeId): number {
    const children = xmlChildren(parent);
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child instanceof Y.XmlElement && child.getAttribute('id') === nodeId) {
        return i;
      }
    }
    return parent.length - 1;
  }
}

function schemaNodeToXml(node: SchemaNode): XmlChild {
  if (node.type === 'text') {
    const text = new Y.XmlText();
    const content = node.text ?? '';
    if (content.length > 0) {
      text.insert(0, content, formatFromMarks(node.marks));
    }
    return text;
  }
  const element = new Y.XmlElement(node.type);
  element.setAttribute('id', node.id);
  for (const [key, value] of Object.entries(node.attrs)) {
    element.setAttribute(key, String(value));
  }
  const children = node.content.map((child) => schemaNodeToXml(child));
  if (children.length > 0) {
    element.insert(0, children);
  }
  return element;
}

function xmlChildren(parent: XmlParent): XmlChild[] {
  const out: XmlChild[] = [];
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
      out.push(child);
    }
  }
  return out;
}

function xmlTextsInOrder(root: XmlParent): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  const walk = (parent: XmlParent): void => {
    for (const child of xmlChildren(parent)) {
      if (child instanceof Y.XmlText) {
        out.push(child);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function asXmlElement(value: unknown): Y.XmlElement | null {
  return value instanceof Y.XmlElement ? (value as Y.XmlElement) : null;
}

function isListItem(element: Y.XmlElement): boolean {
  return element.nodeName === 'listItem' || element.nodeName === 'taskItem';
}

/** Text length of a block in schema offsets: text plus one for each hard break. */
function blockLength(block: Y.XmlElement): number {
  let length = 0;
  for (const child of xmlChildren(block)) {
    length += child instanceof Y.XmlText ? child.length : child.nodeName === 'hardBreak' ? 1 : 0;
  }
  return length;
}

function offsetWithin(block: Y.XmlElement, location: { readonly text: Y.XmlText; readonly index: number }): number {
  let offset = 0;
  for (const child of xmlChildren(block)) {
    if (child === location.text) {
      return offset + location.index;
    }
    offset += child instanceof Y.XmlText ? child.length : child.nodeName === 'hardBreak' ? 1 : 0;
  }
  return -1;
}

function lastXmlText(children: readonly XmlChild[]): Y.XmlText | null {
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i];
    if (child instanceof Y.XmlText) {
      return child;
    }
  }
  return null;
}

function xmlChildrenToSchema(parentId: NodeId, children: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): SchemaNode[] {
  const out: SchemaNode[] = [];
  let textIndex = 0;
  for (const child of children) {
    if (child instanceof Y.XmlText) {
      const runs = xmlTextToRuns(child);
      for (const run of runs) {
        out.push({
          type: 'text',
          id: deriveId(parentId, 'text', textIndex),
          attrs: {},
          content: [],
          marks: marksFromFormat(run.attributes),
          text: run.insert,
        });
        textIndex += 1;
      }
      continue;
    }
    if (!(child instanceof Y.XmlElement)) {
      continue;
    }
    const typeName = child.nodeName;
    if (!isNodeType(typeName) || typeName === 'text' || typeName === 'doc') {
      continue;
    }
    const id = readElementId(child, parentId, typeName);
    out.push({
      type: typeName,
      id,
      attrs: attrsFromXml(typeName, child),
      content: xmlChildrenToSchema(id, child.toArray()),
      marks: [],
    });
  }
  return out;
}

function readElementId(element: Y.XmlElement, parentId: NodeId, purpose: string): NodeId {
  const raw = element.getAttribute('id');
  if (typeof raw === 'string' && raw.length === 26) {
    try {
      return parseId(raw);
    } catch {
      // fall through to derived id
    }
  }
  return deriveId(parentId, purpose, 0);
}

function attrsFromXml(type: NodeType, element: Y.XmlElement): Record<string, AttrValue> {
  const spec = NODE_SPECS[type];
  const attrs: Record<string, AttrValue> = {};
  const raw = element.getAttributes();
  for (const [key, maybeSpec] of Object.entries(spec.attrs) as ReadonlyArray<readonly [string, unknown]>) {
    const attrSpec = asAttrSpec(maybeSpec);
    if (attrSpec === null) {
      continue;
    }
    const value = raw[key];
    if (typeof value !== 'string') {
      continue;
    }
    if (attrSpec.kind === 'integer') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) {
        attrs[key] = parsed;
      }
      continue;
    }
    attrs[key] = value;
  }
  return attrs;
}

type TextRun = {
  readonly insert: string;
  readonly attributes: Readonly<Record<string, unknown>>;
};

function xmlTextToRuns(text: Y.XmlText): TextRun[] {
  const delta: unknown = opaque(text.toDelta());
  if (!Array.isArray(delta)) {
    return [];
  }
  const runs: TextRun[] = [];
  for (const item of delta) {
    if (!isRecord(item)) {
      continue;
    }
    const insert = item.insert;
    if (typeof insert !== 'string' || insert.length === 0) {
      continue;
    }
    const attributes = isRecord(item.attributes) ? item.attributes : {};
    runs.push({ insert, attributes });
  }
  return runs;
}

function formatAddMark(mark: Mark): Record<string, unknown> {
  if (!PHASE1_MARK_SET.has(mark.type)) {
    return {};
  }
  const spec = MARK_SPECS[mark.type];
  if (Object.keys(spec.attrs).length === 0) {
    return { [mark.type]: true };
  }
  return { [mark.type]: { ...mark.attrs } };
}

function formatFromMarks(marks: readonly Mark[]): Record<string, unknown> {
  const format: Record<string, unknown> = {};
  for (const type of PHASE1_MARK_TYPES) {
    format[type] = null;
  }
  for (const mark of marks) {
    if (!PHASE1_MARK_SET.has(mark.type)) {
      continue;
    }
    const spec = MARK_SPECS[mark.type];
    if (Object.keys(spec.attrs).length === 0) {
      format[mark.type] = true;
    } else {
      format[mark.type] = { ...mark.attrs };
    }
  }
  return format;
}

function marksFromFormat(attributes: Readonly<Record<string, unknown>>): Mark[] {
  const marks: Mark[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (!isMarkType(key) || !PHASE1_MARK_SET.has(key) || value === null || value === false || value === undefined) {
      continue;
    }
    const spec = MARK_SPECS[key];
    if (Object.keys(spec.attrs).length === 0) {
      if (value === true) {
        marks.push({ type: key, attrs: {} });
      }
      continue;
    }
    if (!isRecord(value)) {
      continue;
    }
    const attrs: Record<string, AttrValue> = {};
    for (const [attrKey, maybeSpec] of Object.entries(spec.attrs) as ReadonlyArray<
      readonly [string, unknown]
    >) {
      const attrSpec = asAttrSpec(maybeSpec);
      if (attrSpec === null) {
        continue;
      }
      const attrValue = value[attrKey];
      if (attrSpec.kind === 'integer') {
        if (typeof attrValue === 'number' && Number.isSafeInteger(attrValue)) {
          attrs[attrKey] = attrValue;
        }
        continue;
      }
      if (typeof attrValue === 'string') {
        attrs[attrKey] = attrValue;
      }
    }
    marks.push({ type: key, attrs });
  }
  return marks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asAttrSpec(value: unknown): AttrSpec | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null;
  }
  const kind = value.kind;
  if (kind === 'integer' || kind === 'string' || kind === 'id' || kind === 'url') {
    return value as AttrSpec;
  }
  return null;
}

/**
 * Yjs types `toDelta` as any. Collapse to unknown at the boundary.
 */
function opaque(value: unknown): unknown {
  return value;
}
