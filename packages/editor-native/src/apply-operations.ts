import { createId, isAllowedHref, parseDocument, SchemaError } from '@jot/schema';
import type {
  AddMarkOperation,
  AttrValue,
  DeleteNodeOperation,
  DeleteRangeOperation,
  Document,
  DocumentSlice,
  InsertNodeOperation,
  InsertTextOperation,
  Mark,
  MarkType,
  NodeId,
  RemoveMarkOperation,
  ReplaceRangeOperation,
  SchemaNode,
  SchemaOperation,
  SchemaSelection,
  SetNodeAttributesOperation,
} from '@jot/schema';
import {
  ancestorsOf,
  findById,
  isTextBlock,
  requireNode,
  requireParent,
  updateAt,
} from './tree.js';
import { assertScalarString, assertUtf16Offset } from './utf16.js';

const PHASE_MARKS: ReadonlySet<MarkType> = new Set([
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'inlineCode',
  'link',
]);

function assertPhaseMark(type: MarkType): void {
  if (!PHASE_MARKS.has(type)) {
    throw new SchemaError('unsupported-mark', `mark ${type} is not in Phase 1`);
  }
}

function assertLinkMark(mark: Mark): void {
  if (mark.type !== 'link') {
    return;
  }
  const href = mark.attrs.href;
  if (typeof href !== 'string' || !isAllowedHref(href)) {
    throw new SchemaError('invalid-url', 'link href scheme is not allowed');
  }
}

function attrsEqual(
  left: Readonly<Record<string, AttrValue>>,
  right: Readonly<Record<string, AttrValue>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function asDocument(node: SchemaNode): Document {
  if (node.type !== 'doc') {
    throw new SchemaError('invalid-root', 'root node must be type doc');
  }
  return node as Document;
}

function makeText(text: string, marks: readonly Mark[]): SchemaNode {
  assertScalarString(text, 'text');
  return {
    type: 'text',
    id: createId(),
    attrs: {},
    content: [],
    marks: [...marks],
    text,
  };
}

function marksEqual(left: readonly Mark[], right: readonly Mark[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightByType = new Map(right.map((mark) => [mark.type, mark]));
  return left.every((mark) => {
    const other = rightByType.get(mark.type);
    return other !== undefined && attrsEqual(mark.attrs, other.attrs);
  });
}

function blockText(block: SchemaNode): string {
  let text = '';
  for (const child of block.content) {
    if (child.type === 'text') {
      text += child.text ?? '';
    } else if (child.type === 'hardBreak') {
      text += '\n';
    }
  }
  return text;
}

function resolveBlock(
  doc: Document,
  selection: SchemaSelection,
): { block: SchemaNode; offset: number } {
  const node = requireNode(doc, selection.nodeId);
  if (node.type === 'text') {
    const loc = requireParent(doc, node.id);
    if (!isTextBlock(loc.parent)) {
      throw new SchemaError('invalid-position', 'text node is not inside a text block');
    }
    let offset = 0;
    for (const child of loc.parent.content) {
      if (child.id === node.id) {
        assertUtf16Offset(child.text ?? '', selection.offsetUtf16, 'position');
        return { block: loc.parent, offset: offset + selection.offsetUtf16 };
      }
      if (child.type === 'text') {
        offset += child.text?.length ?? 0;
      } else if (child.type === 'hardBreak') {
        offset += 1;
      }
    }
    throw new SchemaError('invalid-position', 'text node offset could not be resolved');
  }
  if (isTextBlock(node)) {
    assertUtf16Offset(blockText(node), selection.offsetUtf16, 'position');
    return { block: node, offset: selection.offsetUtf16 };
  }
  if (node.type === 'listItem' || node.type === 'taskItem') {
    const paragraph = node.content.find((child) => child.type === 'paragraph');
    if (paragraph === undefined) {
      throw new SchemaError('invalid-position', 'list item has no paragraph');
    }
    assertUtf16Offset(blockText(paragraph), selection.offsetUtf16, 'position');
    return { block: paragraph, offset: selection.offsetUtf16 };
  }
  throw new SchemaError('invalid-position', `cannot place a caret in ${node.type}`);
}

function atBlock(
  block: SchemaNode,
  offset: number,
  affinity: SchemaSelection['affinity'],
): SchemaSelection {
  return { nodeId: block.id, offsetUtf16: offset, affinity, revision: 0 };
}

function mergeAdjacentText(block: SchemaNode): SchemaNode {
  const content: SchemaNode[] = [];
  for (const child of block.content) {
    const prev = content.at(-1);
    if (child.type === 'text' && prev?.type === 'text' && marksEqual(prev.marks, child.marks)) {
      content[content.length - 1] = {
        ...prev,
        text: (prev.text ?? '') + (child.text ?? ''),
      };
      continue;
    }
    content.push(child);
  }
  return { ...block, content };
}

function insertIntoBlock(
  block: SchemaNode,
  offset: number,
  text: string,
  storedMarks: readonly Mark[],
): SchemaNode {
  assertScalarString(text, 'insertText');
  assertUtf16Offset(blockText(block), offset, 'insertText');
  const marks = block.type === 'codeBlock' ? [] : storedMarks;
  if (block.content.length === 0) {
    return { ...block, content: [makeText(text, marks)] };
  }
  const content = [...block.content];
  let acc = 0;
  for (let i = 0; i < content.length; i += 1) {
    const child = content[i];
    if (child === undefined || child.type !== 'text') {
      if (child?.type === 'hardBreak') {
        acc += 1;
      }
      continue;
    }
    const piece = child.text ?? '';
    const end = acc + piece.length;
    if (offset < acc || offset > end) {
      acc = end;
      continue;
    }
    const local = offset - acc;
    if (marksEqual(child.marks, marks) || block.type === 'codeBlock') {
      content[i] = {
        ...child,
        text: piece.slice(0, local) + text + piece.slice(local),
        marks: block.type === 'codeBlock' ? [] : child.marks,
      };
      return mergeAdjacentText({ ...block, content });
    }
    const left = local > 0 ? [{ ...child, text: piece.slice(0, local) }] : [];
    const mid = [makeText(text, marks)];
    const right =
      local < piece.length ? [{ ...child, id: createId(), text: piece.slice(local) }] : [];
    content.splice(i, 1, ...left, ...mid, ...right);
    return mergeAdjacentText({ ...block, content });
  }
  const last = content.at(-1);
  if (last?.type === 'text' && (marksEqual(last.marks, marks) || block.type === 'codeBlock')) {
    content[content.length - 1] = {
      ...last,
      text: (last.text ?? '') + text,
      marks: block.type === 'codeBlock' ? [] : last.marks,
    };
  } else {
    content.push(makeText(text, marks));
  }
  return mergeAdjacentText({ ...block, content });
}

function deleteFromBlock(block: SchemaNode, fromOff: number, toOff: number): SchemaNode {
  const text = blockText(block);
  assertUtf16Offset(text, fromOff, 'deleteRange');
  assertUtf16Offset(text, toOff, 'deleteRange');
  const start = Math.min(fromOff, toOff);
  const end = Math.max(fromOff, toOff);
  if (start === end) {
    return block;
  }
  const content: SchemaNode[] = [];
  let acc = 0;
  for (const child of block.content) {
    if (child.type !== 'text') {
      if (child.type === 'hardBreak') {
        const hardStart = acc;
        acc += 1;
        if (hardStart < start || hardStart >= end) {
          content.push(child);
        }
      } else {
        content.push(child);
      }
      continue;
    }
    const piece = child.text ?? '';
    const pieceStart = acc;
    const pieceEnd = acc + piece.length;
    acc = pieceEnd;
    if (pieceEnd <= start || pieceStart >= end) {
      content.push(child);
      continue;
    }
    const left = piece.slice(0, Math.max(0, start - pieceStart));
    const right = piece.slice(Math.max(0, end - pieceStart));
    if (left.length > 0) {
      content.push({ ...child, text: left });
    }
    if (right.length > 0) {
      content.push({
        ...child,
        id: left.length > 0 ? createId() : child.id,
        text: right,
      });
    }
  }
  return mergeAdjacentText({ ...block, content });
}

function extractBlockText(block: SchemaNode, fromOff: number, toOff: number): string {
  return blockText(block).slice(Math.min(fromOff, toOff), Math.max(fromOff, toOff));
}

function applyMarkToBlock(
  block: SchemaNode,
  fromOff: number,
  toOff: number,
  mutate: (marks: readonly Mark[]) => Mark[],
): SchemaNode {
  const text = blockText(block);
  const start = Math.min(fromOff, toOff);
  const end = Math.max(fromOff, toOff);
  assertUtf16Offset(text, start, 'mark');
  assertUtf16Offset(text, end, 'mark');
  if (start === end || block.type === 'codeBlock') {
    return block;
  }
  const content: SchemaNode[] = [];
  let acc = 0;
  for (const child of block.content) {
    if (child.type !== 'text') {
      content.push(child);
      if (child.type === 'hardBreak') {
        acc += 1;
      }
      continue;
    }
    const piece = child.text ?? '';
    const pieceStart = acc;
    const pieceEnd = acc + piece.length;
    acc = pieceEnd;
    const overlapStart = Math.max(start, pieceStart);
    const overlapEnd = Math.min(end, pieceEnd);
    if (overlapStart >= overlapEnd) {
      content.push(child);
      continue;
    }
    const left = piece.slice(0, overlapStart - pieceStart);
    const mid = piece.slice(overlapStart - pieceStart, overlapEnd - pieceStart);
    const right = piece.slice(overlapEnd - pieceStart);
    if (left.length > 0) {
      content.push({ ...child, text: left });
    }
    if (mid.length > 0) {
      content.push({
        ...child,
        id: left.length > 0 ? createId() : child.id,
        text: mid,
        marks: mutate(child.marks),
      });
    }
    if (right.length > 0) {
      content.push({
        ...child,
        id: createId(),
        text: right,
      });
    }
  }
  return mergeAdjacentText({ ...block, content });
}

function addMarkToMarks(marks: readonly Mark[], mark: Mark): Mark[] {
  return [...marks.filter((item) => item.type !== mark.type), mark];
}

function sliceText(slice: DocumentSlice): { text: string; marks: readonly Mark[] } {
  const parts: string[] = [];
  let marks: readonly Mark[] = [];
  const walk = (nodes: readonly SchemaNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        parts.push(node.text ?? '');
        marks = node.marks;
        continue;
      }
      walk(node.content);
    }
  };
  walk(slice.nodes);
  return { text: parts.join(''), marks };
}

function nextListItem(doc: Document, paragraph: SchemaNode): SchemaNode | undefined {
  const itemLoc =
    findById(doc, paragraph.id) === undefined ? undefined : requireParent(doc, paragraph.id);
  if (itemLoc === undefined) {
    return undefined;
  }
  const item = itemLoc.parent;
  if (item.type !== 'listItem' && item.type !== 'taskItem') {
    return undefined;
  }
  const listLoc = requireParent(doc, item.id);
  const next = listLoc.parent.content[listLoc.index + 1];
  return next;
}

function applyInsertText(doc: Document, op: InsertTextOperation): Document {
  const resolved = resolveBlock(doc, op.position);
  const nextBlock = insertIntoBlock(resolved.block, resolved.offset, op.text, op.storedMarks);
  return asDocument(updateAt(doc, resolved.block.id, () => nextBlock));
}

function joinListItems(doc: Document, fromBlock: SchemaNode, toBlock: SchemaNode): Document {
  const fromItemLoc = requireParent(doc, fromBlock.id);
  const toItemLoc = requireParent(doc, toBlock.id);
  if (
    (fromItemLoc.parent.type !== 'listItem' && fromItemLoc.parent.type !== 'taskItem') ||
    (toItemLoc.parent.type !== 'listItem' && toItemLoc.parent.type !== 'taskItem')
  ) {
    throw new SchemaError('invalid-range', 'list join requires two list items');
  }
  const fromItem = fromItemLoc.parent;
  const toItem = toItemLoc.parent;
  const fromList = requireParent(doc, fromItem.id);
  const toList = requireParent(doc, toItem.id);
  if (fromList.parent.id !== toList.parent.id || toList.index !== fromList.index + 1) {
    throw new SchemaError('invalid-range', 'list join requires adjacent items');
  }
  const mergedParagraph = mergeAdjacentText({
    ...fromBlock,
    content: [...fromBlock.content, ...toBlock.content],
  });
  const fromRest = fromItem.content.filter((child) => child.id !== fromBlock.id);
  const toRest = toItem.content.filter((child) => child.id !== toBlock.id);
  const mergedItem: SchemaNode = {
    ...fromItem,
    content: [mergedParagraph, ...fromRest, ...toRest],
  };
  const withoutTo = asDocument(
    updateAt(doc, fromList.parent.id, (list) => ({
      ...list,
      content: list.content.filter((child) => child.id !== toItem.id),
    })),
  );
  return asDocument(updateAt(withoutTo, fromItem.id, () => mergedItem));
}

function applyDeleteRange(doc: Document, op: DeleteRangeOperation): Document {
  const from = resolveBlock(doc, op.from);
  const to = resolveBlock(doc, op.to);
  if (from.block.id === to.block.id) {
    const nextBlock = deleteFromBlock(from.block, from.offset, to.offset);
    return asDocument(updateAt(doc, from.block.id, () => nextBlock));
  }
  if (from.offset === blockText(from.block).length && to.offset === 0) {
    return joinListItems(doc, from.block, to.block);
  }
  throw new SchemaError('invalid-range', 'deleteRange across unrelated blocks is not supported');
}

function applyReplaceRange(doc: Document, op: ReplaceRangeOperation): Document {
  const from = resolveBlock(doc, op.from);
  const deleted = applyDeleteRange(doc, {
    type: 'deleteRange',
    from: op.from,
    to: op.to,
    deletedSlice: op.deletedSlice,
  });
  const { text, marks } = sliceText(op.slice);
  if (text.length === 0 && op.slice.nodes.length === 0) {
    return deleted;
  }
  const insertAt =
    findById(deleted, from.block.id) === undefined
      ? op.from
      : atBlock(from.block, from.offset, op.from.affinity);
  return applyInsertText(deleted, {
    type: 'insertText',
    position: insertAt,
    text,
    storedMarks: marks,
  });
}

function applyAddMark(doc: Document, op: AddMarkOperation): Document {
  assertPhaseMark(op.mark.type);
  assertLinkMark(op.mark);
  const from = resolveBlock(doc, op.range.from);
  const to = resolveBlock(doc, op.range.to);
  if (from.block.id !== to.block.id) {
    throw new SchemaError('invalid-range', 'addMark must stay inside one text block');
  }
  const nextBlock = applyMarkToBlock(from.block, from.offset, to.offset, (marks) =>
    addMarkToMarks(marks, op.mark),
  );
  return asDocument(updateAt(doc, from.block.id, () => nextBlock));
}

function applyRemoveMark(doc: Document, op: RemoveMarkOperation): Document {
  assertPhaseMark(op.markType);
  const from = resolveBlock(doc, op.range.from);
  const to = resolveBlock(doc, op.range.to);
  if (from.block.id !== to.block.id) {
    throw new SchemaError('invalid-range', 'removeMark must stay inside one text block');
  }
  const nextBlock = applyMarkToBlock(from.block, from.offset, to.offset, (marks) =>
    marks.filter((mark) => mark.type !== op.markType),
  );
  return asDocument(updateAt(doc, from.block.id, () => nextBlock));
}

function applySetNodeAttributes(doc: Document, op: SetNodeAttributesOperation): Document {
  return asDocument(
    updateAt(doc, op.nodeId, (node) => ({
      ...node,
      attrs: { ...node.attrs, ...op.patch },
    })),
  );
}

function applyInsertNode(doc: Document, op: InsertNodeOperation): Document {
  requireNode(doc, op.parentId);
  return asDocument(
    updateAt(doc, op.parentId, (parent) => {
      if (op.index < 0 || op.index > parent.content.length) {
        throw new SchemaError('invalid-index', `insert index ${String(op.index)} is out of range`);
      }
      const content = [...parent.content];
      content.splice(op.index, 0, op.node);
      return { ...parent, content };
    }),
  );
}

function applyDeleteNode(doc: Document, op: DeleteNodeOperation): Document {
  if (op.nodeId === doc.id) {
    throw new SchemaError('invalid-node', 'cannot delete the document root');
  }
  requireNode(doc, op.nodeId);
  const loc = requireParent(doc, op.nodeId);
  return asDocument(
    updateAt(doc, loc.parent.id, (parent) => ({
      ...parent,
      content: parent.content.filter((child) => child.id !== op.nodeId),
    })),
  );
}

function applyOne(doc: Document, operation: SchemaOperation): Document {
  switch (operation.type) {
    case 'insertText':
      return applyInsertText(doc, operation);
    case 'deleteRange':
      return applyDeleteRange(doc, operation);
    case 'replaceRange':
      return applyReplaceRange(doc, operation);
    case 'addMark':
      return applyAddMark(doc, operation);
    case 'removeMark':
      return applyRemoveMark(doc, operation);
    case 'setNodeAttributes':
      return applySetNodeAttributes(doc, operation);
    case 'insertNode':
      return applyInsertNode(doc, operation);
    case 'deleteNode':
      return applyDeleteNode(doc, operation);
  }
}

function capturedText(doc: Document, from: SchemaSelection, to: SchemaSelection): string {
  const start = resolveBlock(doc, from);
  const end = resolveBlock(doc, to);
  if (start.block.id === end.block.id) {
    return extractBlockText(start.block, start.offset, end.offset);
  }
  return '';
}

function invertInsertText(doc: Document, op: InsertTextOperation): SchemaOperation[] {
  const resolved = resolveBlock(doc, op.position);
  const from = atBlock(resolved.block, resolved.offset, op.position.affinity);
  const to = atBlock(resolved.block, resolved.offset + op.text.length, op.position.affinity);
  return [
    {
      type: 'deleteRange',
      from,
      to,
      deletedSlice: { nodes: [makeText(op.text, op.storedMarks)] },
    },
  ];
}

function invertDeleteRange(doc: Document, op: DeleteRangeOperation): SchemaOperation[] {
  const from = resolveBlock(doc, op.from);
  const to = resolveBlock(doc, op.to);
  if (from.block.id === to.block.id) {
    const text = extractBlockText(from.block, from.offset, to.offset);
    return [
      {
        type: 'insertText',
        position: atBlock(from.block, Math.min(from.offset, to.offset), op.from.affinity),
        text,
        storedMarks: [],
      },
    ];
  }
  const nextItem = nextListItem(doc, from.block);
  if (nextItem === undefined) {
    return [{ ...op }];
  }
  const list = requireParent(doc, nextItem.id);
  return [
    {
      type: 'insertNode',
      parentId: list.parent.id,
      index: list.index,
      node: nextItem,
    },
    {
      type: 'deleteRange',
      from: atBlock(from.block, from.offset, 'after'),
      to: atBlock(from.block, from.offset + blockText(to.block).length, 'after'),
      deletedSlice: { nodes: [] },
    },
  ];
}

function invertReplaceRange(doc: Document, op: ReplaceRangeOperation): SchemaOperation[] {
  const from = resolveBlock(doc, op.from);
  const deletedText = capturedText(doc, op.from, op.to);
  const inserted = sliceText(op.slice).text;
  const start = atBlock(from.block, from.offset, op.from.affinity);
  return [
    {
      type: 'replaceRange',
      from: start,
      to: atBlock(from.block, from.offset + inserted.length, op.to.affinity),
      slice: { nodes: deletedText.length === 0 ? [] : [makeText(deletedText, [])] },
      deletedSlice: op.slice,
    },
  ];
}

function invertAddMark(op: AddMarkOperation): SchemaOperation[] {
  return [{ type: 'removeMark', range: op.range, markType: op.mark.type }];
}

function invertRemoveMark(doc: Document, op: RemoveMarkOperation): SchemaOperation[] {
  const from = resolveBlock(doc, op.range.from);
  const mark: Mark = { type: op.markType, attrs: {} };
  const overlapping = from.block.content.find(
    (child) => child.type === 'text' && child.marks.some((item) => item.type === op.markType),
  );
  return [
    {
      type: 'addMark',
      range: op.range,
      mark: overlapping?.marks.find((item) => item.type === op.markType) ?? mark,
    },
  ];
}

function invertSetNodeAttributes(doc: Document, op: SetNodeAttributesOperation): SchemaOperation[] {
  const node = requireNode(doc, op.nodeId);
  const prior: Record<string, AttrValue> = { ...op.priorValues };
  for (const key of Object.keys(op.patch)) {
    const value = node.attrs[key];
    if (value !== undefined && prior[key] === undefined) {
      prior[key] = value;
    }
  }
  return [
    {
      type: 'setNodeAttributes',
      nodeId: op.nodeId,
      patch: prior,
      priorValues: op.patch,
    },
  ];
}

function invertInsertNode(op: InsertNodeOperation): SchemaOperation[] {
  return [{ type: 'deleteNode', nodeId: op.node.id, deletedNode: op.node }];
}

function invertDeleteNode(doc: Document, op: DeleteNodeOperation): SchemaOperation[] {
  const loc = requireParent(doc, op.nodeId);
  return [
    {
      type: 'insertNode',
      parentId: loc.parent.id,
      index: loc.index,
      node: op.deletedNode,
    },
  ];
}

export function invertOperation(
  doc: Document,
  operation: SchemaOperation,
): readonly SchemaOperation[] {
  switch (operation.type) {
    case 'insertText':
      return invertInsertText(doc, operation);
    case 'deleteRange':
      return invertDeleteRange(doc, operation);
    case 'replaceRange':
      return invertReplaceRange(doc, operation);
    case 'addMark':
      return invertAddMark(operation);
    case 'removeMark':
      return invertRemoveMark(doc, operation);
    case 'setNodeAttributes':
      return invertSetNodeAttributes(doc, operation);
    case 'insertNode':
      return invertInsertNode(operation);
    case 'deleteNode':
      return invertDeleteNode(doc, operation);
  }
}

export function invertOperations(
  doc: Document,
  operations: readonly SchemaOperation[],
): readonly SchemaOperation[] {
  let current = parseDocument(doc);
  const inverses: SchemaOperation[] = [];
  for (const operation of operations) {
    inverses.push(...invertOperation(current, operation));
    current = applyOne(current, operation);
  }
  return inverses.reverse();
}

export function applyOperations(doc: Document, operations: readonly SchemaOperation[]): Document {
  let current = parseDocument(doc);
  for (const operation of operations) {
    current = applyOne(current, operation);
  }
  return parseDocument(current);
}

export function selectionBlock(doc: Document, selection: SchemaSelection): SchemaNode {
  return resolveBlock(doc, selection).block;
}

export function selectionOffset(doc: Document, selection: SchemaSelection): number {
  return resolveBlock(doc, selection).offset;
}

export function marksAtSelection(doc: Document, selection: SchemaSelection): readonly Mark[] {
  const { block, offset } = resolveBlock(doc, selection);
  let acc = 0;
  let last: readonly Mark[] = [];
  for (const child of block.content) {
    if (child.type !== 'text') {
      if (child.type === 'hardBreak') {
        acc += 1;
      }
      continue;
    }
    const piece = child.text ?? '';
    const end = acc + piece.length;
    if (offset > acc && offset <= end) {
      return child.marks;
    }
    if (offset === acc) {
      return last.length > 0 ? last : child.marks;
    }
    last = child.marks;
    acc = end;
  }
  return last;
}

export function findAncestor(
  doc: Document,
  nodeId: NodeId,
  predicate: (node: SchemaNode) => boolean,
): SchemaNode | undefined {
  return ancestorsOf(doc, nodeId).find(predicate);
}

export { requireNode, requireParent };
