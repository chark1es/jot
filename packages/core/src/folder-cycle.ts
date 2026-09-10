import type { FolderId } from '@jot/schema';
import { compareLogicalTime, type LogicalTime } from './clock.js';

/**
 * Folder cycle repair: remove the newest parent edge involved in a cycle.
 * Never delete a Folder or its Notes.
 */
export const FOLDER_CYCLE_REPAIR_RULE = 'remove-newest-parent-edge' as const;

export type FolderParentEdge = {
  readonly childId: FolderId;
  readonly parentId: FolderId;
  readonly logicalTime: LogicalTime;
};

export type FolderCycleRepair = {
  readonly rule: typeof FOLDER_CYCLE_REPAIR_RULE;
  readonly removedEdge: FolderParentEdge;
};

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

/**
 * If parent edges contain a cycle, return the newest parent edge to remove.
 * Does not delete Folders or Notes.
 */
export function newestParentEdgeToRemove(
  parentEdges: readonly FolderParentEdge[],
): FolderCycleRepair | null {
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
    return { rule: FOLDER_CYCLE_REPAIR_RULE, removedEdge: newest };
  }
  return null;
}
