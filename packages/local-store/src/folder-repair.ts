import type { FolderId, LogicalTime } from '@jot/schema';

/**
 * Same rule as @jot/core newestParentEdgeToRemove: remove the newest parent
 * edge in a cycle. Duplicated here because local-store cannot import core.
 */
export type FolderParentEdge = {
  readonly childId: FolderId;
  readonly parentId: FolderId;
  readonly logicalTime: LogicalTime;
};

function compareLogicalTime(a: LogicalTime, b: LogicalTime): number {
  if (a.counter !== b.counter) {
    return a.counter < b.counter ? -1 : 1;
  }
  if (a.deviceId < b.deviceId) {
    return -1;
  }
  if (a.deviceId > b.deviceId) {
    return 1;
  }
  return 0;
}

function walkCycle(
  edges: ReadonlyMap<FolderId, FolderParentEdge>,
  start: FolderId,
): FolderParentEdge[] | null {
  const seen: FolderId[] = [];
  let current: FolderId | undefined = start;
  while (current !== undefined) {
    const index = seen.indexOf(current);
    if (index !== -1) {
      const cycleIds = seen.slice(index);
      const cycleEdges: FolderParentEdge[] = [];
      for (const id of cycleIds) {
        const edge = edges.get(id);
        if (!edge) {
          return null;
        }
        cycleEdges.push(edge);
      }
      return cycleEdges;
    }
    seen.push(current);
    const edge = edges.get(current);
    current = edge?.parentId;
  }
  return null;
}

export function newestParentEdgeToRemove(
  parentEdges: readonly FolderParentEdge[],
): FolderParentEdge | null {
  const byChild = new Map<FolderId, FolderParentEdge>();
  for (const edge of parentEdges) {
    byChild.set(edge.childId, edge);
  }
  for (const child of byChild.keys()) {
    const cycle = walkCycle(byChild, child);
    if (!cycle || cycle.length === 0) {
      continue;
    }
    let newest = cycle[0];
    if (!newest) {
      continue;
    }
    for (const edge of cycle.slice(1)) {
      if (compareLogicalTime(edge.logicalTime, newest.logicalTime) > 0) {
        newest = edge;
      }
    }
    return newest;
  }
  return null;
}
