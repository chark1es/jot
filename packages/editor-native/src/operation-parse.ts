import { isMarkType, isNodeType, parseId, SchemaError } from '@jot/schema';
import type {
  AttrValue,
  DocumentSlice,
  Mark,
  SchemaNode,
  SchemaOperation,
  SchemaSelection,
} from '@jot/schema';

/**
 * Parses operations reported by a native editor. Kept free of Expo imports so scripts and tests
 * outside React Native can check native output the way the app reads it.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new SchemaError('invalid-string', `${path}: expected a string`);
  }
  return value;
}

function readSafeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SchemaError('non-integer', `${path}: expected a safe integer`);
  }
  return value;
}

function parseAttrValue(value: unknown, path: string): AttrValue {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new SchemaError('invalid-attr', `${path}: expected a string or integer`);
}

function parseAttrs(value: unknown, path: string): Record<string, AttrValue> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new SchemaError('invalid-attrs', `${path}: expected an object`);
  }
  const attrs: Record<string, AttrValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    attrs[key] = parseAttrValue(raw, `${path}.${key}`);
  }
  return attrs;
}

function parseMark(value: unknown, path: string): Mark {
  if (!isRecord(value)) {
    throw new SchemaError('invalid-mark', `${path}: expected a mark object`);
  }
  const type = value.type;
  if (typeof type !== 'string' || !isMarkType(type)) {
    throw new SchemaError('invalid-mark', `${path}: unknown mark type`);
  }
  return { type, attrs: parseAttrs(value.attrs, `${path}.attrs`) };
}

function parseMarks(value: unknown, path: string): Mark[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new SchemaError('invalid-marks', `${path}: expected an array`);
  }
  return value.map((item, index) => parseMark(item, `${path}[${String(index)}]`));
}

function parseSchemaNode(value: unknown, path: string): SchemaNode {
  if (!isRecord(value)) {
    throw new SchemaError('invalid-node', `${path}: expected a node object`);
  }
  const type = value.type;
  if (typeof type !== 'string' || !isNodeType(type)) {
    throw new SchemaError('unknown-node-type', `${path}: unknown node type`);
  }
  const id = parseId(readString(value.id, `${path}.id`));
  const contentInput = value.content;
  const content: SchemaNode[] = [];
  if (contentInput !== undefined) {
    if (!Array.isArray(contentInput)) {
      throw new SchemaError('invalid-content', `${path}.content: expected an array`);
    }
    for (const [index, child] of contentInput.entries()) {
      content.push(parseSchemaNode(child, `${path}.content[${String(index)}]`));
    }
  }
  const marks = type === 'text' ? parseMarks(value.marks, `${path}.marks`) : [];
  const text = type === 'text' ? readString(value.text, `${path}.text`) : undefined;
  return {
    type,
    id,
    attrs: parseAttrs(value.attrs, `${path}.attrs`),
    content,
    marks,
    ...(text !== undefined ? { text } : {}),
  };
}

function parseSelection(value: unknown, path: string): SchemaSelection {
  if (!isRecord(value)) {
    throw new SchemaError('invalid-selection', `${path}: expected an object`);
  }
  const affinity = value.affinity;
  if (affinity !== 'before' && affinity !== 'after') {
    throw new SchemaError('invalid-selection', `${path}.affinity: expected before or after`);
  }
  return {
    nodeId: parseId(readString(value.nodeId, `${path}.nodeId`)),
    offsetUtf16: readSafeInteger(value.offsetUtf16, `${path}.offsetUtf16`),
    affinity,
    revision: readSafeInteger(value.revision, `${path}.revision`),
  };
}

function parseSlice(value: unknown, path: string): DocumentSlice {
  if (value === undefined) {
    return { nodes: [] };
  }
  if (Array.isArray(value)) {
    return {
      nodes: value.map((item, index) => parseSchemaNode(item, `${path}[${String(index)}]`)),
    };
  }
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    throw new SchemaError('invalid-slice', `${path}: expected { nodes }`);
  }
  return {
    nodes: value.nodes.map((item, index) =>
      parseSchemaNode(item, `${path}.nodes[${String(index)}]`),
    ),
  };
}

function parseRange(
  value: unknown,
  path: string,
): {
  readonly from: SchemaSelection;
  readonly to: SchemaSelection;
} {
  if (!isRecord(value)) {
    throw new SchemaError('invalid-range', `${path}: expected an object`);
  }
  return {
    from: parseSelection(value.from, `${path}.from`),
    to: parseSelection(value.to, `${path}.to`),
  };
}

export function parseSchemaOperations(value: unknown): SchemaOperation[] {
  if (!Array.isArray(value)) {
    throw new SchemaError('invalid-operations', 'operations must be an array');
  }
  return value.map((item, index) => parseSchemaOperation(item, `operations[${String(index)}]`));
}

function parseSchemaOperation(value: unknown, path: string): SchemaOperation {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new SchemaError('invalid-operation', `${path}: expected an operation object`);
  }
  switch (value.type) {
    case 'insertText':
      return {
        type: 'insertText',
        position: parseSelection(value.position, `${path}.position`),
        text: readString(value.text, `${path}.text`),
        storedMarks: parseMarks(value.storedMarks, `${path}.storedMarks`),
      };
    case 'deleteRange':
      return {
        type: 'deleteRange',
        from: parseSelection(value.from, `${path}.from`),
        to: parseSelection(value.to, `${path}.to`),
        deletedSlice: parseSlice(value.deletedSlice, `${path}.deletedSlice`),
      };
    case 'replaceRange':
      return {
        type: 'replaceRange',
        from: parseSelection(value.from, `${path}.from`),
        to: parseSelection(value.to, `${path}.to`),
        slice: parseSlice(value.slice, `${path}.slice`),
        deletedSlice: parseSlice(value.deletedSlice, `${path}.deletedSlice`),
      };
    case 'addMark': {
      const range = parseRange(value.range, `${path}.range`);
      return {
        type: 'addMark',
        range,
        mark: parseMark(value.mark, `${path}.mark`),
      };
    }
    case 'removeMark': {
      const range = parseRange(value.range, `${path}.range`);
      const markType = value.markType;
      if (typeof markType !== 'string' || !isMarkType(markType)) {
        throw new SchemaError('invalid-operation', `${path}.markType: unknown mark`);
      }
      return { type: 'removeMark', range, markType };
    }
    case 'setNodeAttributes':
      return {
        type: 'setNodeAttributes',
        nodeId: parseId(readString(value.nodeId, `${path}.nodeId`)),
        patch: parseAttrs(value.patch, `${path}.patch`),
        priorValues: parseAttrs(value.priorValues, `${path}.priorValues`),
      };
    case 'insertNode':
      return {
        type: 'insertNode',
        parentId: parseId(readString(value.parentId, `${path}.parentId`)),
        index: readSafeInteger(value.index, `${path}.index`),
        node: parseSchemaNode(value.node, `${path}.node`),
      };
    case 'deleteNode':
      return {
        type: 'deleteNode',
        nodeId: parseId(readString(value.nodeId, `${path}.nodeId`)),
        deletedNode: parseSchemaNode(value.deletedNode, `${path}.deletedNode`),
      };
    default:
      throw new SchemaError('invalid-operation', `${path}: unknown type ${value.type}`);
  }
}
