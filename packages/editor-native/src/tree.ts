import { SchemaError } from '@jot/schema';
import type { NodeId, SchemaNode } from '@jot/schema';

export function findById(node: SchemaNode, id: NodeId): SchemaNode | undefined {
  if (node.id === id) {
    return node;
  }
  for (const child of node.content) {
    const found = findById(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function findParent(
  root: SchemaNode,
  id: NodeId,
): { parent: SchemaNode; index: number } | undefined {
  for (const [index, child] of root.content.entries()) {
    if (child.id === id) {
      return { parent: root, index };
    }
    const nested = findParent(child, id);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

export function requireNode(root: SchemaNode, id: NodeId): SchemaNode {
  const node = findById(root, id);
  if (node === undefined) {
    throw new SchemaError('unknown-node', `node ${id} not found`);
  }
  return node;
}

export function requireParent(root: SchemaNode, id: NodeId): { parent: SchemaNode; index: number } {
  const loc = findParent(root, id);
  if (loc === undefined) {
    throw new SchemaError('unknown-node', `parent of ${id} not found`);
  }
  return loc;
}

export function updateAt(
  root: SchemaNode,
  id: NodeId,
  updater: (node: SchemaNode) => SchemaNode,
): SchemaNode {
  if (root.id === id) {
    return updater(root);
  }
  const content = root.content.map((child) => updateAt(child, id, updater));
  if (content.every((child, index) => child === root.content[index])) {
    return root;
  }
  return { ...root, content };
}

export function ancestorsOf(root: SchemaNode, id: NodeId): SchemaNode[] {
  const path: SchemaNode[] = [];
  function walk(node: SchemaNode): boolean {
    if (node.id === id) {
      path.push(node);
      return true;
    }
    for (const child of node.content) {
      if (walk(child)) {
        path.push(node);
        return true;
      }
    }
    return false;
  }
  if (!walk(root)) {
    throw new SchemaError('unknown-node', `node ${id} not found`);
  }
  return path;
}

export function isTextBlock(node: SchemaNode): boolean {
  return node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock';
}
