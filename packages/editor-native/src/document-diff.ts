import type { Document, SchemaOperation } from '@jot/schema';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Top-level node operations that turn `from` into `to`. Matching blocks at the start and end
 * are left alone, so restoring a version only replaces the blocks that differ, and the result
 * is an ordinary edit that undo can reverse.
 */
export function documentDiffOperations(from: Document, to: Document): SchemaOperation[] {
  const before = from.content.map(stableJson);
  const after = to.content.map(stableJson);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const operations: SchemaOperation[] = [];
  for (let index = oldEnd - 1; index >= prefix; index -= 1) {
    const node = from.content[index];
    if (node !== undefined) {
      operations.push({ type: 'deleteNode', nodeId: node.id, deletedNode: node });
    }
  }
  for (let index = prefix; index < newEnd; index += 1) {
    const node = to.content[index];
    if (node !== undefined) {
      operations.push({ type: 'insertNode', parentId: from.id, index, node });
    }
  }
  return operations;
}
