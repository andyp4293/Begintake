export interface FlowLayoutNode {
  id: string;
  type: string;
  label: string;
  config: any;
  sortOrder: number;
}

export interface FlowLayoutEdge {
  sourceNodeId: string;
  targetNodeId: string;
  label: string | null;
  condition: string | null;
  sortOrder: number;
}

export interface TreeLayout {
  width: number;
  center: number;
  left: number;
  right: number;
  slotWidth: number;
  slotLeft: number;
  slotRight: number;
  childCenters: Map<string, number>;
  leftContour: number[];
  rightContour: number[];
}

export interface PrimaryChildPlacement {
  edge: FlowLayoutEdge;
  childId: string;
  childLayout: TreeLayout;
  childCenter: number;
  childLeft: number;
}

export const CARD_WIDTH_PX = 272;
export const CHILD_GAP_PX = 28;

export const FALLBACK_LAYOUT: TreeLayout = {
  width: CARD_WIDTH_PX,
  center: CARD_WIDTH_PX / 2,
  left: CARD_WIDTH_PX / 2,
  right: CARD_WIDTH_PX / 2,
  slotWidth: CARD_WIDTH_PX,
  slotLeft: CARD_WIDTH_PX / 2,
  slotRight: CARD_WIDTH_PX / 2,
  childCenters: new Map(),
  leftContour: [-(CARD_WIDTH_PX / 2)],
  rightContour: [CARD_WIDTH_PX / 2],
};

export function getSiblingGap(branchCount: number) {
  if (branchCount >= 7) return 64;
  if (branchCount >= 5) return 52;
  if (branchCount >= 3) return 40;
  return CHILD_GAP_PX;
}

export function computePathToNode(targetId: string, primaryParents: Map<string, string>): string[] {
  const path: string[] = [];
  let current: string | undefined = targetId;
  while (current) {
    path.unshift(current);
    current = primaryParents.get(current);
  }
  return path;
}

export function computePrimaryParents(rootId: string, edges: FlowLayoutEdge[]): Map<string, string> {
  const primaryParent = new Map<string, string>();
  const childrenOf = new Map<string, FlowLayoutEdge[]>();
  const sortedEdges = [...edges].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const edge of sortedEdges) {
    if (!childrenOf.has(edge.sourceNodeId)) childrenOf.set(edge.sourceNodeId, []);
    childrenOf.get(edge.sourceNodeId)!.push(edge);
  }

  const visited = new Set<string>();

  function dfs(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    for (const edge of childrenOf.get(nodeId) || []) {
      if (!primaryParent.has(edge.targetNodeId)) {
        primaryParent.set(edge.targetNodeId, nodeId);
      }
      dfs(edge.targetNodeId);
    }
  }

  dfs(rootId);
  return primaryParent;
}

export function computeVisibleTreeLayouts(
  rootId: string,
  edges: FlowLayoutEdge[],
  primaryParents: Map<string, string>,
  expandedNodeIds: Set<string>,
  expandedOverrides: Set<string>,
): Map<string, TreeLayout> {
  const primaryChildrenOf = new Map<string, string[]>();
  const sortedEdges = [...edges].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const edge of sortedEdges) {
    if (primaryParents.get(edge.targetNodeId) !== edge.sourceNodeId) continue;
    if (!primaryChildrenOf.has(edge.sourceNodeId)) primaryChildrenOf.set(edge.sourceNodeId, []);
    primaryChildrenOf.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }

  const visibleExpanded = new Set([...expandedNodeIds, ...expandedOverrides]);
  const layouts = new Map<string, TreeLayout>();

  function walk(nodeId: string): TreeLayout {
    const primaryChildren = primaryChildrenOf.get(nodeId) || [];
    if (!visibleExpanded.has(nodeId) || primaryChildren.length === 0) {
      layouts.set(nodeId, FALLBACK_LAYOUT);
      return FALLBACK_LAYOUT;
    }

    const childLayouts = primaryChildren.map((childId) => ({ childId, layout: walk(childId) }));
    const siblingGap = getSiblingGap(primaryChildren.length);

    const placedChildren: Array<{ childId: string; layout: TreeLayout; center: number }> = [];
    const aggregateRightContour: number[] = [];

    childLayouts.forEach(({ childId, layout }, index) => {
      let center = 0;

      if (index > 0) {
        center = layout.leftContour.reduce((requiredShift, leftAtDepth, depth) => {
          const occupiedRight = aggregateRightContour[depth];
          if (occupiedRight === undefined) return requiredShift;
          return Math.max(requiredShift, occupiedRight + siblingGap - leftAtDepth);
        }, 0);
      }

      placedChildren.push({ childId, layout, center });

      layout.rightContour.forEach((rightAtDepth, depth) => {
        const absoluteRight = center + rightAtDepth;
        aggregateRightContour[depth] = aggregateRightContour[depth] === undefined
          ? absoluteRight
          : Math.max(aggregateRightContour[depth]!, absoluteRight);
      });
    });

    const firstCenter = placedChildren[0]?.center ?? 0;
    const lastCenter = placedChildren[placedChildren.length - 1]?.center ?? 0;
    const naturalCenter = placedChildren.length === 1 ? 0 : (firstCenter + lastCenter) / 2;

    const childLeftContour: number[] = [];
    const childRightContour: number[] = [];

    placedChildren.forEach(({ center, layout }) => {
      layout.leftContour.forEach((leftAtDepth, depth) => {
        const absoluteLeft = center - naturalCenter + leftAtDepth;
        const parentDepth = depth + 1;
        childLeftContour[parentDepth] = childLeftContour[parentDepth] === undefined
          ? absoluteLeft
          : Math.min(childLeftContour[parentDepth]!, absoluteLeft);
      });

      layout.rightContour.forEach((rightAtDepth, depth) => {
        const absoluteRight = center - naturalCenter + rightAtDepth;
        const parentDepth = depth + 1;
        childRightContour[parentDepth] = childRightContour[parentDepth] === undefined
          ? absoluteRight
          : Math.max(childRightContour[parentDepth]!, absoluteRight);
      });
    });

    const leftContour = [-(CARD_WIDTH_PX / 2), ...childLeftContour.slice(1)];
    const rightContour = [CARD_WIDTH_PX / 2, ...childRightContour.slice(1)];
    const minLeftEdge = Math.min(...leftContour);
    const maxRightEdge = Math.max(...rightContour);
    const left = Math.max(CARD_WIDTH_PX / 2, -minLeftEdge);
    const right = Math.max(CARD_WIDTH_PX / 2, maxRightEdge);
    const center = left;
    const width = left + right;
    const nodeLayout: TreeLayout = {
      width,
      center,
      left,
      right,
      slotWidth: width,
      slotLeft: left,
      slotRight: right,
      childCenters: new Map(
        placedChildren.map(({ childId, center: childCenter }) => [
          childId,
          childCenter - naturalCenter + left,
        ]),
      ),
      leftContour,
      rightContour,
    };

    layouts.set(nodeId, nodeLayout);
    return nodeLayout;
  }

  walk(rootId);
  return layouts;
}

export function getPrimaryChildPlacements(
  parentId: string,
  childEdges: FlowLayoutEdge[],
  primaryParents: Map<string, string>,
  treeLayouts: Map<string, TreeLayout>,
): PrimaryChildPlacement[] {
  const parentLayout = treeLayouts.get(parentId) ?? FALLBACK_LAYOUT;

  return childEdges
    .filter((edge) => primaryParents.get(edge.targetNodeId) === parentId)
    .map((edge) => {
      const childLayout = treeLayouts.get(edge.targetNodeId) ?? FALLBACK_LAYOUT;
      const childCenter = parentLayout.childCenters.get(edge.targetNodeId) ?? parentLayout.center;

      return {
        edge,
        childId: edge.targetNodeId,
        childLayout,
        childCenter,
        childLeft: Math.max(childCenter - childLayout.center, 0),
      };
    })
    .sort((a, b) => a.childCenter - b.childCenter || a.edge.sortOrder - b.edge.sortOrder || a.childId.localeCompare(b.childId));
}

export function getConnectorSpan(
  placements: Array<{ childCenter: number }>,
  fallbackCenter: number,
) {
  if (placements.length === 0) {
    return { start: fallbackCenter, end: fallbackCenter, width: 1 };
  }

  const centers = placements.map((placement) => placement.childCenter);
  const start = Math.min(...centers);
  const end = Math.max(...centers);

  return {
    start,
    end,
    width: Math.max(end - start, 1),
  };
}
