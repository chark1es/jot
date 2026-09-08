import type { CanonicalObject, CanonicalValue } from "./canonical-json.js";
import { canonicalize, canonicalizeToString } from "./canonical-json.js";
import { IdError, SchemaError } from "./errors.js";
import { deriveId, parseId } from "./ids.js";
import type { NodeId } from "./ids.js";
import {
  isAllowedHref,
  isHexPalette,
  isMarkType,
  isNodeType,
  MARK_SPECS,
  NODE_SPECS,
} from "./schema-table.js";
import type { AttrSpec, ContentModel, MarkType, NodeSpec, NodeType } from "./schema-table.js";
import type { AttrValue, Document, Mark, SchemaNode } from "./types.js";
import { rejectUnpairedSurrogates, utf8Compare } from "./utf8.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string, message: string): never {
  throw new SchemaError(code, message);
}

function readInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    fail("non-integer", `${path}: expected a safe integer`);
  }
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail("invalid-string", `${path}: expected a string`);
  }
  rejectUnpairedSurrogates(value, path);
  return value;
}

function readAttr(spec: AttrSpec, value: unknown, path: string, key: string): AttrValue {
  switch (spec.kind) {
    case "integer": {
      const integer = readInteger(value, path);
      if (spec.min !== undefined && integer < spec.min) {
        fail("attr-range", `${path}: expected >= ${String(spec.min)}`);
      }
      if (spec.max !== undefined && integer > spec.max) {
        fail("attr-range", `${path}: expected <= ${String(spec.max)}`);
      }
      return integer;
    }
    case "string": {
      const text = readString(value, path);
      if (key === "paletteId") {
        if (text.length === 0 || isHexPalette(text)) {
          fail("palette-id", `${path}: paletteId must be a token palette id, not hex or empty`);
        }
      }
      return text;
    }
    case "id":
      try {
        return parseId(readString(value, path));
      } catch (error) {
        if (error instanceof IdError) {
          fail("invalid-id", `${path}: ${error.message}`);
        }
        throw error;
      }
    case "url": {
      const href = readString(value, path);
      if (!isAllowedHref(href)) {
        fail("invalid-url", `${path}: URL scheme is not allowed`);
      }
      return href;
    }
  }
}

function defaultAttr(spec: AttrSpec): AttrValue | undefined {
  if (spec.kind === "integer" && spec.default !== undefined) {
    return spec.default;
  }
  if (spec.kind === "string" && spec.default !== undefined) {
    return spec.default;
  }
  return undefined;
}

function readAttrs(
  specs: Readonly<Record<string, AttrSpec>>,
  input: unknown,
  path: string,
): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = {};
  if (input !== undefined) {
    if (!isRecord(input)) {
      fail("invalid-attrs", `${path}: attrs must be an object`);
    }
    for (const [key, value] of Object.entries(input)) {
      const spec = specs[key];
      if (spec === undefined) {
        continue;
      }
      attrs[key] = readAttr(spec, value, `${path}.${key}`, key);
    }
  }
  for (const [key, spec] of Object.entries(specs)) {
    if (Object.hasOwn(attrs, key)) {
      continue;
    }
    const fallback = defaultAttr(spec);
    if (fallback === undefined) {
      fail("missing-attr", `${path}.${key}: required attribute is missing`);
    }
    attrs[key] = fallback;
  }
  return attrs;
}

function sortMarks(marks: readonly Mark[]): Mark[] {
  const sorted = [...marks].sort((left, right) => {
    const byType = utf8Compare(left.type, right.type);
    if (byType !== 0) {
      return byType;
    }
    return utf8Compare(canonicalizeToString(left.attrs), canonicalizeToString(right.attrs));
  });
  const seen = new Set<MarkType>();
  const unique: Mark[] = [];
  for (const mark of sorted) {
    if (seen.has(mark.type)) {
      continue;
    }
    seen.add(mark.type);
    unique.push(mark);
  }
  return unique;
}

function readMark(input: unknown, path: string): Mark {
  if (!isRecord(input)) {
    fail("invalid-mark", `${path}: expected a mark object`);
  }
  const typeValue = input.type;
  if (typeof typeValue !== "string" || !isMarkType(typeValue)) {
    fail("unknown-mark-type", `${path}: unknown mark type ${String(typeValue)}`);
  }
  const attrs = readAttrs(MARK_SPECS[typeValue].attrs, input.attrs, `${path}.attrs`);
  return { type: typeValue, attrs };
}

function readMarks(input: unknown, path: string): Mark[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    fail("invalid-marks", `${path}: marks must be an array`);
  }
  return sortMarks(input.map((item, index) => readMark(item, `${path}[${String(index)}]`)));
}

function readNodeId(input: unknown, path: string): NodeId {
  try {
    return parseId(readString(input, path));
  } catch (error) {
    if (error instanceof IdError) {
      fail("invalid-id", `${path}: ${error.message}`);
    }
    throw error;
  }
}

function readNode(input: unknown, path: string): SchemaNode {
  if (!isRecord(input)) {
    fail("invalid-node", `${path}: expected a node object`);
  }
  const typeValue = input.type;
  if (typeof typeValue !== "string") {
    fail("invalid-node", `${path}: missing type`);
  }
  if (!isNodeType(typeValue)) {
    fail("unknown-node-type", `${path}: unknown node type ${typeValue}`);
  }
  const spec = NODE_SPECS[typeValue];
  const id = readNodeId(input.id, `${path}.id`);
  const attrs = readAttrs(spec.attrs, input.attrs, `${path}.attrs`);
  const marks = typeValue === "text" ? readMarks(input.marks, `${path}.marks`) : [];
  let text: string | undefined;
  if (typeValue === "text") {
    text = readString(input.text, `${path}.text`);
  }
  const contentInput = input.content;
  const content: SchemaNode[] = [];
  if (contentInput !== undefined) {
    if (!Array.isArray(contentInput)) {
      fail("invalid-content", `${path}.content: expected an array`);
    }
    for (const [index, child] of contentInput.entries()) {
      content.push(readNode(child, `${path}.content[${String(index)}]`));
    }
  }
  const node: SchemaNode = {
    type: typeValue,
    id,
    attrs,
    content,
    marks,
    ...(text !== undefined ? { text } : {}),
  };
  return node;
}

function isInlineNode(node: SchemaNode): boolean {
  return NODE_SPECS[node.type].group === "inline";
}

function isBlockNode(node: SchemaNode): boolean {
  return NODE_SPECS[node.type].group === "block";
}

function extractInlines(node: SchemaNode): SchemaNode[] {
  if (isInlineNode(node)) {
    return [node];
  }
  return node.content.flatMap(extractInlines);
}

function extractPlainText(node: SchemaNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (node.type === "mathInline") {
    const latex = node.attrs.latex;
    const alt = node.attrs.alt;
    return typeof latex === "string" && latex.length > 0
      ? latex
      : typeof alt === "string"
        ? alt
        : "";
  }
  return node.content.map(extractPlainText).join("");
}

function paragraphWrapping(parentId: NodeId, index: number, inlines: readonly SchemaNode[]): SchemaNode {
  return {
    type: "paragraph",
    id: deriveId(parentId, "paragraph", index),
    attrs: {},
    content: [...inlines],
    marks: [],
  };
}

function wrapAs(type: NodeType, parentId: NodeId, purpose: string, index: number, children: readonly SchemaNode[]): SchemaNode {
  const spec: NodeSpec = NODE_SPECS[type];
  const attrs: Record<string, AttrValue> = {};
  for (const [key, specAttr] of Object.entries(spec.attrs)) {
    const fallback = defaultAttr(specAttr);
    if (fallback !== undefined) {
      attrs[key] = fallback;
    }
  }
  return {
    type,
    id: deriveId(parentId, purpose, index),
    attrs,
    content: [...children],
    marks: [],
  };
}

function coerceToInlines(nodes: readonly SchemaNode[]): SchemaNode[] {
  return nodes.flatMap((node) => (isInlineNode(node) ? [node] : extractInlines(node)));
}

function coerceToTextNodes(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  const out: SchemaNode[] = [];
  for (const [index, node] of nodes.entries()) {
    if (node.type === "text") {
      out.push({ ...node, marks: [] });
      continue;
    }
    const text = extractPlainText(node);
    if (text.length === 0) {
      continue;
    }
    out.push({
      type: "text",
      id: deriveId(parentId, "text", index),
      attrs: {},
      content: [],
      marks: [],
      text,
    });
  }
  return out;
}

function wrapInlineRuns(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  const out: SchemaNode[] = [];
  let run: SchemaNode[] = [];
  let runIndex = 0;
  const flush = (): void => {
    if (run.length === 0) {
      return;
    }
    out.push(paragraphWrapping(parentId, runIndex, run));
    run = [];
  };
  for (const [index, node] of nodes.entries()) {
    if (isInlineNode(node)) {
      if (run.length === 0) {
        runIndex = index;
      }
      run.push(node);
      continue;
    }
    flush();
    out.push(node);
  }
  flush();
  return out;
}

function coerceBlocks(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  const promoted: SchemaNode[] = [];
  for (const [index, node] of nodes.entries()) {
    if (isBlockNode(node) || isInlineNode(node)) {
      if (NODE_SPECS[node.type].content === "none" && node.content.length > 0) {
        const trailing = extractInlines({ ...node, content: node.content });
        promoted.push({ ...node, content: [] });
        if (trailing.length > 0) {
          promoted.push(paragraphWrapping(parentId, index, trailing));
        }
        continue;
      }
      promoted.push(node);
      continue;
    }
    switch (node.type) {
      case "listItem":
        promoted.push(wrapAs("bulletList", parentId, "bulletList", index, [node]));
        break;
      case "taskItem":
        promoted.push(wrapAs("taskList", parentId, "taskList", index, [node]));
        break;
      case "tableRow":
        promoted.push(wrapAs("table", parentId, "table", index, [node]));
        break;
      case "tableCell":
        promoted.push(
          wrapAs("table", parentId, "table", index, [
            wrapAs("tableRow", parentId, "tableRow", index, [node]),
          ]),
        );
        break;
      case "caption":
        promoted.push({
          type: "paragraph",
          id: node.id,
          attrs: {},
          content: node.content,
          marks: [],
        });
        break;
      default:
        promoted.push(paragraphWrapping(parentId, index, extractInlines(node)));
    }
  }
  return wrapInlineRuns(parentId, promoted);
}

function coerceListItems(type: "listItem" | "taskItem", parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  return nodes.map((node, index) => {
    if (node.type === type) {
      return node;
    }
    const body = isInlineNode(node) || isBlockNode(node) ? [node] : extractInlines(node);
    return wrapAs(type, parentId, type, index, body);
  });
}

function coerceTableRows(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  return nodes.map((node, index) => {
    if (node.type === "tableRow") {
      return node;
    }
    if (node.type === "tableCell") {
      return wrapAs("tableRow", parentId, "tableRow", index, [node]);
    }
    return wrapAs("tableRow", parentId, "tableRow", index, [
      wrapAs("tableCell", parentId, "tableCell", index, [node]),
    ]);
  });
}

function coerceTableCells(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  return nodes.map((node, index) => {
    if (node.type === "tableCell") {
      return node;
    }
    return wrapAs("tableCell", parentId, "tableCell", index, [node]);
  });
}

function coerceListItemBody(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  const allowed = new Set<NodeType>(["paragraph", "bulletList", "orderedList", "taskList"]);
  const promoted: SchemaNode[] = [];
  for (const [index, node] of nodes.entries()) {
    if (allowed.has(node.type)) {
      promoted.push(node);
      continue;
    }
    if (node.type === "listItem") {
      promoted.push(wrapAs("bulletList", parentId, "bulletList", index, [node]));
      continue;
    }
    if (node.type === "taskItem") {
      promoted.push(wrapAs("taskList", parentId, "taskList", index, [node]));
      continue;
    }
    const inlines = isInlineNode(node) ? [node] : extractInlines(node);
    promoted.push(paragraphWrapping(parentId, index, inlines));
  }
  return wrapInlineRuns(parentId, promoted);
}

function coerceCaption(parentId: NodeId, nodes: readonly SchemaNode[]): SchemaNode[] {
  const captions = nodes.filter((node) => node.type === "caption");
  const others = nodes.filter((node) => node.type !== "caption");
  const extraInlines = [...captions.slice(1), ...others].flatMap(extractInlines);
  const first = captions[0];
  if (first === undefined && extraInlines.length === 0) {
    return [];
  }
  const caption: SchemaNode = {
    type: "caption",
    id: first?.id ?? deriveId(parentId, "caption", 0),
    attrs: {},
    content: [...(first?.content ?? []), ...extraInlines],
    marks: [],
  };
  return [caption];
}

function coerceChildren(node: SchemaNode, model: ContentModel): SchemaNode[] {
  switch (model) {
    case "blocks":
      return coerceBlocks(node.id, node.content);
    case "inlines":
      return coerceToInlines(node.content);
    case "text":
      return coerceToTextNodes(node.id, node.content);
    case "none":
      return [];
    case "listItems":
      return coerceListItems("listItem", node.id, node.content);
    case "taskItems":
      return coerceListItems("taskItem", node.id, node.content);
    case "tableRows":
      return coerceTableRows(node.id, node.content);
    case "tableCells":
      return coerceTableCells(node.id, node.content);
    case "listItemBody":
      return coerceListItemBody(node.id, node.content);
    case "captionOrNone":
      return coerceCaption(node.id, node.content);
  }
}

function repair(node: SchemaNode): SchemaNode {
  const repairedChildren = node.content.map(repair);
  const withChildren: SchemaNode = { ...node, content: repairedChildren };
  const spec = NODE_SPECS[node.type];
  let content = coerceChildren(withChildren, spec.content);
  if (node.type === "codeBlock") {
    content = content.map((child) =>
      child.type === "text" ? { ...child, marks: [] } : child,
    );
  }
  return {
    ...node,
    content,
    marks: node.type === "text" ? sortMarks(node.marks) : [],
  };
}

export function parseDocument(input: unknown): Document {
  const node = repair(readNode(input, "$"));
  if (node.type !== "doc") {
    fail("invalid-root", "root node must be type doc");
  }
  return node as Document;
}

export function nodeToCanonical(node: SchemaNode): CanonicalObject {
  const spec = NODE_SPECS[node.type];
  const object: Record<string, CanonicalValue> = {};
  if (Object.keys(spec.attrs).length > 0) {
    object.attrs = { ...node.attrs };
  }
  if (spec.content !== "none") {
    object.content = node.content.map(nodeToCanonical);
  }
  object.id = node.id;
  if (node.type === "text") {
    object.marks = node.marks.map((mark) => markToCanonical(mark));
    object.text = node.text ?? "";
  }
  object.type = node.type;
  return object;
}

export function markToCanonical(mark: Mark): CanonicalObject {
  const object: Record<string, CanonicalValue> = {};
  if (Object.keys(mark.attrs).length > 0) {
    object.attrs = { ...mark.attrs };
  }
  object.type = mark.type;
  return object;
}

export function documentToCanonical(document: Document): CanonicalObject {
  return nodeToCanonical(document);
}

export function canonicalizeDocument(input: unknown): Uint8Array {
  return canonicalize(documentToCanonical(parseDocument(input)));
}

export function canonicalizeDocumentToString(input: unknown): string {
  return canonicalizeToString(documentToCanonical(parseDocument(input)));
}
