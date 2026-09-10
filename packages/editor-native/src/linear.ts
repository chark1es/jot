import { parseDocument, parseId, SchemaError } from '@jot/schema';
import type { AttrValue, Document, Mark, SchemaNode } from '@jot/schema';
import { assertScalarString } from './utf16.js';

export const OBJECT_REPLACEMENT = '\uFFFC';
export const HARD_BREAK_TEXT = '\u2028';

export type LinearMarkType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'inlineCode'
  | 'link';

export type LinearInlineMark = {
  readonly type: LinearMarkType;
  readonly attrs: Readonly<Record<string, AttrValue>>;
};

export type LinearRun = {
  readonly text: string;
  readonly marks: readonly LinearInlineMark[];
  readonly id: string;
  readonly atom?: 'hardBreak';
  readonly placeholderNode?: SchemaNode;
};

export type LinearBlockKind =
  | 'paragraph'
  | 'heading'
  | 'codeBlock'
  | 'bulletItem'
  | 'orderedItem'
  | 'taskItem'
  | 'blockquote'
  | 'horizontalRule'
  | 'image'
  | 'placeholder';

export type LinearBlock = {
  readonly id: string;
  readonly kind: LinearBlockKind;
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly listStart?: number;
  readonly checked?: 0 | 1;
  readonly indent: number;
  readonly runs: readonly LinearRun[];
  readonly languageId?: string;
  readonly paragraphId?: string;
  readonly listId?: string;
  readonly attachmentId?: string;
  readonly widthBasisPoints?: number;
  readonly alt?: string;
  readonly caption?: readonly LinearRun[];
  readonly captionId?: string;
  readonly placeholderNode?: SchemaNode;
};

export type LinearDocument = {
  readonly id: string;
  readonly blocks: readonly LinearBlock[];
};

function isLinearMarkType(type: Mark['type']): type is LinearMarkType {
  switch (type) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strikethrough':
    case 'inlineCode':
    case 'link':
      return true;
    default:
      return false;
  }
}

const ITEM_KIND = {
  bulletList: 'bulletItem',
  orderedList: 'orderedItem',
  taskList: 'taskItem',
} as const satisfies Record<string, LinearBlockKind>;

type ListWrapperType = keyof typeof ITEM_KIND;

function isListWrapper(type: SchemaNode['type']): type is ListWrapperType {
  return type === 'bulletList' || type === 'orderedList' || type === 'taskList';
}

function isItemKind(kind: LinearBlockKind): kind is 'bulletItem' | 'orderedItem' | 'taskItem' {
  return kind === 'bulletItem' || kind === 'orderedItem' || kind === 'taskItem';
}

function listTypeFor(kind: 'bulletItem' | 'orderedItem' | 'taskItem'): ListWrapperType {
  if (kind === 'bulletItem') {
    return 'bulletList';
  }
  if (kind === 'orderedItem') {
    return 'orderedList';
  }
  return 'taskList';
}

function asInteger(value: AttrValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asString(value: AttrValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function headingLevelOf(node: SchemaNode): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = asInteger(node.attrs.level, 1);
  if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5 || level === 6) {
    return level;
  }
  throw new SchemaError('attr-range', `heading level ${String(level)} is out of range`);
}

function checkedOf(node: SchemaNode): 0 | 1 {
  const checked = asInteger(node.attrs.checked, 0);
  return checked === 1 ? 1 : 0;
}

function linearMarks(marks: readonly Mark[]): LinearInlineMark[] {
  const out: LinearInlineMark[] = [];
  for (const mark of marks) {
    if (!isLinearMarkType(mark.type)) {
      continue;
    }
    if (mark.type === 'link') {
      out.push({
        type: 'link',
        attrs: {
          href: asString(mark.attrs.href, ''),
          title: asString(mark.attrs.title, ''),
        },
      });
      continue;
    }
    out.push({ type: mark.type, attrs: {} });
  }
  return out;
}

function schemaMarks(marks: readonly LinearInlineMark[]): Mark[] {
  return marks.map((mark) => {
    if (mark.type === 'link') {
      return {
        type: 'link',
        attrs: {
          href: asString(mark.attrs.href, ''),
          title: asString(mark.attrs.title, ''),
        },
      };
    }
    return { type: mark.type, attrs: {} };
  });
}

function atomicRun(node: SchemaNode): LinearRun {
  return {
    id: node.id,
    text: OBJECT_REPLACEMENT,
    marks: [],
    placeholderNode: node,
  };
}

function inlinesToRuns(block: SchemaNode): LinearRun[] {
  const runs: LinearRun[] = [];
  for (const child of block.content) {
    if (child.type === 'hardBreak') {
      runs.push({
        id: child.id,
        text: HARD_BREAK_TEXT,
        marks: [],
        atom: 'hardBreak',
      });
      continue;
    }
    if (child.type !== 'text') {
      runs.push(atomicRun(child));
      continue;
    }
    const text = child.text ?? '';
    assertScalarString(text, `run:${child.id}`);
    runs.push({
      id: child.id,
      text,
      marks: linearMarks(child.marks),
    });
  }
  return runs;
}

function captionOf(node: SchemaNode): SchemaNode | undefined {
  return node.content.find((child) => child.type === 'caption');
}

function emitBlocks(nodes: readonly SchemaNode[], indent: number, out: LinearBlock[]): void {
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      out.push({
        id: node.id,
        kind: 'paragraph',
        indent,
        runs: inlinesToRuns(node),
      });
      continue;
    }
    if (node.type === 'heading') {
      out.push({
        id: node.id,
        kind: 'heading',
        headingLevel: headingLevelOf(node),
        indent,
        runs: inlinesToRuns(node),
      });
      continue;
    }
    if (node.type === 'codeBlock') {
      out.push({
        id: node.id,
        kind: 'codeBlock',
        indent,
        runs: inlinesToRuns(node),
        languageId: asString(node.attrs.languageId, ''),
      });
      continue;
    }
    if (node.type === 'blockquote') {
      out.push({
        id: node.id,
        kind: 'blockquote',
        indent,
        runs: [],
      });
      emitBlocks(node.content, indent + 1, out);
      continue;
    }
    if (node.type === 'horizontalRule') {
      out.push({
        id: node.id,
        kind: 'horizontalRule',
        indent,
        runs: [atomicRun(node)],
      });
      continue;
    }
    if (node.type === 'image') {
      const caption = captionOf(node);
      out.push({
        id: node.id,
        kind: 'image',
        indent,
        runs: [atomicRun(node)],
        attachmentId: asString(node.attrs.attachmentId, ''),
        widthBasisPoints: asInteger(node.attrs.widthBasisPoints, 10000),
        alt: asString(node.attrs.alt, ''),
        ...(caption === undefined
          ? {}
          : { captionId: caption.id, caption: inlinesToRuns(caption) }),
      });
      continue;
    }
    if (isListWrapper(node.type)) {
      emitList(node, ITEM_KIND[node.type], indent, out);
      continue;
    }
    out.push({
      id: node.id,
      kind: 'placeholder',
      indent,
      runs: [atomicRun(node)],
      placeholderNode: node,
    });
  }
}

function emitList(
  list: SchemaNode,
  kind: 'bulletItem' | 'orderedItem' | 'taskItem',
  indent: number,
  out: LinearBlock[],
): void {
  for (const [index, item] of list.content.entries()) {
    let firstParagraph: SchemaNode | undefined;
    const nested: SchemaNode[] = [];
    for (const child of item.content) {
      if (firstParagraph === undefined && child.type === 'paragraph') {
        firstParagraph = child;
      } else {
        nested.push(child);
      }
    }
    const block: LinearBlock = {
      id: item.id,
      kind,
      indent,
      runs: firstParagraph === undefined ? [] : inlinesToRuns(firstParagraph),
      listId: list.id,
      ...(firstParagraph === undefined ? {} : { paragraphId: firstParagraph.id }),
      ...(kind === 'orderedItem' && index === 0
        ? { listStart: asInteger(list.attrs.start, 1) }
        : {}),
      ...(kind === 'taskItem' ? { checked: checkedOf(item) } : {}),
    };
    out.push(block);
    emitBlocks(nested, indent + 1, out);
  }
}

export function documentToLinear(doc: Document): LinearDocument {
  const parsed = parseDocument(doc);
  const blocks: LinearBlock[] = [];
  emitBlocks(parsed.content, 0, blocks);
  return { id: parsed.id, blocks };
}

function runsToNodes(runs: readonly LinearRun[], stripMarks: boolean): SchemaNode[] {
  return runs.map((run) => {
    if (run.atom === 'hardBreak') {
      return {
        type: 'hardBreak' as const,
        id: parseId(run.id),
        attrs: {},
        content: [],
        marks: [],
      };
    }
    if (run.placeholderNode !== undefined) {
      return run.placeholderNode;
    }
    assertScalarString(run.text, `run:${run.id}`);
    return {
      type: 'text' as const,
      id: parseId(run.id),
      attrs: {},
      content: [],
      marks: stripMarks ? [] : schemaMarks(run.marks),
      text: run.text,
    };
  });
}

function imageToNode(block: LinearBlock): SchemaNode {
  const caption =
    block.caption === undefined
      ? []
      : [
          {
            type: 'caption' as const,
            id: parseId(block.captionId ?? block.id),
            attrs: {},
            content: runsToNodes(block.caption, false),
            marks: [],
          },
        ];
  return {
    type: 'image',
    id: parseId(block.id),
    attrs: {
      attachmentId: parseId(block.attachmentId ?? ''),
      widthBasisPoints: block.widthBasisPoints ?? 10000,
      alt: block.alt ?? '',
    },
    content: caption,
    marks: [],
  };
}

function blockToNode(block: LinearBlock): SchemaNode {
  if (block.kind === 'heading') {
    const level = block.headingLevel ?? 1;
    return {
      type: 'heading',
      id: parseId(block.id),
      attrs: { level },
      content: runsToNodes(block.runs, false),
      marks: [],
    };
  }
  if (block.kind === 'codeBlock') {
    return {
      type: 'codeBlock',
      id: parseId(block.id),
      attrs: { languageId: block.languageId ?? '' },
      content: runsToNodes(block.runs, true),
      marks: [],
    };
  }
  return {
    type: 'paragraph',
    id: parseId(block.id),
    attrs: {},
    content: runsToNodes(block.runs, false),
    marks: [],
  };
}

function itemToNode(item: LinearBlock, nested: readonly SchemaNode[]): SchemaNode {
  const paragraphId = item.paragraphId ?? item.id;
  const paragraph: SchemaNode = {
    type: 'paragraph',
    id: parseId(paragraphId),
    attrs: {},
    content: runsToNodes(item.runs, false),
    marks: [],
  };
  if (item.kind === 'taskItem') {
    return {
      type: 'taskItem',
      id: parseId(item.id),
      attrs: { checked: item.checked ?? 0 },
      content: [paragraph, ...nested],
      marks: [],
    };
  }
  return {
    type: 'listItem',
    id: parseId(item.id),
    attrs: {},
    content: [paragraph, ...nested],
    marks: [],
  };
}

function listToNode(
  type: ListWrapperType,
  listId: string,
  items: readonly SchemaNode[],
  listStart: number | undefined,
): SchemaNode {
  return {
    type,
    id: parseId(listId),
    attrs: type === 'orderedList' ? { start: listStart ?? 1 } : {},
    content: [...items],
    marks: [],
  };
}

function consume(
  blocks: readonly LinearBlock[],
  index: number,
  indent: number,
): { children: SchemaNode[]; next: number } {
  const children: SchemaNode[] = [];
  let i = index;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block === undefined || block.indent < indent) {
      break;
    }
    if (block.indent > indent) {
      throw new SchemaError(
        'linear-indent',
        `expected indent ${String(indent)}, got ${String(block.indent)}`,
      );
    }
    if (block.kind === 'blockquote') {
      i += 1;
      const nested = consume(blocks, i, indent + 1);
      i = nested.next;
      children.push({
        type: 'blockquote',
        id: parseId(block.id),
        attrs: {},
        content: nested.children,
        marks: [],
      });
      continue;
    }
    if (block.kind === 'horizontalRule') {
      children.push({
        type: 'horizontalRule',
        id: parseId(block.id),
        attrs: {},
        content: [],
        marks: [],
      });
      i += 1;
      continue;
    }
    if (block.kind === 'image') {
      children.push(imageToNode(block));
      i += 1;
      continue;
    }
    if (block.kind === 'placeholder') {
      if (block.placeholderNode !== undefined) {
        children.push(block.placeholderNode);
      }
      i += 1;
      continue;
    }
    if (isItemKind(block.kind)) {
      const items: SchemaNode[] = [];
      const listId = block.listId ?? block.id;
      const kind = block.kind;
      const listStart = block.listStart;
      while (i < blocks.length) {
        const item = blocks[i];
        if (
          item === undefined ||
          item.kind !== kind ||
          item.indent !== indent ||
          (item.listId !== undefined && item.listId !== listId)
        ) {
          break;
        }
        i += 1;
        const nested = consume(blocks, i, indent + 1);
        i = nested.next;
        items.push(itemToNode(item, nested.children));
      }
      children.push(listToNode(listTypeFor(kind), listId, items, listStart));
      continue;
    }
    children.push(blockToNode(block));
    i += 1;
  }
  return { children, next: i };
}

export function linearToDocument(linear: LinearDocument): Document {
  const { children, next } = consume(linear.blocks, 0, 0);
  if (next !== linear.blocks.length) {
    throw new SchemaError('linear-indent', 'unconsumed linear blocks remain');
  }
  return parseDocument({
    type: 'doc',
    id: parseId(linear.id),
    attrs: {},
    content: children,
    marks: [],
  });
}
