export type FolderRecord = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly manualPosition: string;
};

export type FolderTreeNode = {
  readonly folder: FolderRecord;
  readonly depth: number;
  readonly children: readonly FolderTreeNode[];
};

function compareFolders(a: FolderRecord, b: FolderRecord): number {
  const byPosition = a.manualPosition.localeCompare(b.manualPosition);
  if (byPosition !== 0) {
    return byPosition;
  }
  return a.name.localeCompare(b.name);
}

function childrenOf(
  folders: readonly FolderRecord[],
  parentId: string | null,
): FolderRecord[] {
  return folders.filter((folder) => folder.parentId === parentId).sort(compareFolders);
}

function walk(
  folders: readonly FolderRecord[],
  parentId: string | null,
  depth: number,
  ancestry: ReadonlySet<string>,
): FolderTreeNode[] {
  const nodes: FolderTreeNode[] = [];
  for (const folder of childrenOf(folders, parentId)) {
    if (ancestry.has(folder.id)) {
      continue;
    }
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(folder.id);
    nodes.push({
      folder,
      depth,
      children: walk(folders, folder.id, depth + 1, nextAncestry),
    });
  }
  return nodes;
}

/**
 * Nested folder tree. Cycle edges are skipped; the store repairs cycles,
 * the UI only renders the resulting acyclic shape.
 */
export function buildFolderTree(folders: readonly FolderRecord[]): FolderTreeNode[] {
  return walk(folders, null, 0, new Set());
}

export function flattenFolderTree(nodes: readonly FolderTreeNode[]): FolderTreeNode[] {
  const flat: FolderTreeNode[] = [];
  for (const node of nodes) {
    flat.push(node);
    flat.push(...flattenFolderTree(node.children));
  }
  return flat;
}

export function descendantIds(nodes: readonly FolderTreeNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const node of flattenFolderTree(nodes)) {
    ids.add(node.folder.id);
  }
  return ids;
}

export function findSubtree(
  nodes: readonly FolderTreeNode[],
  folderId: string,
): FolderTreeNode | undefined {
  for (const node of nodes) {
    if (node.folder.id === folderId) {
      return node;
    }
    const nested = findSubtree(node.children, folderId);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

export function folderPathLabel(
  folders: readonly FolderRecord[],
  folderId: string,
  separator = ' / ',
): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return names.join(separator);
}
