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

export interface VisibleTreeNodePlacement {
  nodeId: string;
  depth: number;
  centerX: number;
  parentId: string | null;
  incomingEdge: FlowLayoutEdge | null;
}

export interface VisibleTreeMap {
  nodes: VisibleTreeNodePlacement[];
  rows: Map<number, VisibleTreeNodePlacement[]>;
  maxDepth: number;
}

export interface VirtualTreeNodeBox {
  nodeId: string;
  depth: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface VirtualTreeBranchSlice {
  ownerNodeId: string;
  absoluteDepth: number;
  left: number;
  right: number;
}

export interface VirtualTreeRenderModel {
  visibleTree: VisibleTreeMap;
  nodeBoxes: Map<string, VirtualTreeNodeBox>;
  branchSlices: Map<string, VirtualTreeBranchSlice[]>;
}

export interface VirtualTreeRenderOptions {
  rootHeaderHeight?: number;
  rowHeight?: number;
  nodeTop?: number;
  labeledNodeTop?: number;
  cardHeight?: number;
}

export interface VirtualNodeOverlap {
  leftNodeId: string;
  rightNodeId: string;
  depth: number;
  overlap: number;
}

export interface VirtualBranchOverlap {
  parentId: string;
  leftNodeId: string;
  rightNodeId: string;
  absoluteDepth: number;
  overlap: number;
}

export const CARD_WIDTH_PX = 272;
export const CHILD_GAP_PX = 28;
export const LEVEL_GAP_PX = 36;
export const NODE_FORCE_FIELD_PX = 16;
export const BRANCH_FORCE_FIELD_PX = 16;
export const BRANCH_LANE_GUTTER_PX = CARD_WIDTH_PX / 2;
export const MIN_VISIBLE_NODE_CLEARANCE_PX = CARD_WIDTH_PX;
export const DENSE_ROW_THRESHOLD = 4;
export const DENSE_ROW_EXTRA_FOOTPRINT_PX = MIN_VISIBLE_NODE_CLEARANCE_PX - LEVEL_GAP_PX;
export const VERY_DENSE_ROW_THRESHOLD = 8;
export const VERY_DENSE_ROW_EXTRA_FOOTPRINT_PX = MIN_VISIBLE_NODE_CLEARANCE_PX;
export const EXTREME_DENSE_ROW_THRESHOLD = 16;
export const EXTREME_DENSE_ROW_EXTRA_FOOTPRINT_PX = MIN_VISIBLE_NODE_CLEARANCE_PX + 48;
export const VIRTUAL_ROOT_HEADER_HEIGHT_PX = 92;
export const VIRTUAL_TREE_ROW_HEIGHT_PX = 360;
export const VIRTUAL_TREE_NODE_TOP_PX = 24;
export const VIRTUAL_TREE_NODE_TOP_WITH_LABEL_PX = 72;
export const VIRTUAL_TREE_CARD_HEIGHT_PX = 88;

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

export function getDenseRowExtraFootprint(nodeCount: number) {
  if (nodeCount >= EXTREME_DENSE_ROW_THRESHOLD) return EXTREME_DENSE_ROW_EXTRA_FOOTPRINT_PX;
  if (nodeCount >= VERY_DENSE_ROW_THRESHOLD) return VERY_DENSE_ROW_EXTRA_FOOTPRINT_PX;
  if (nodeCount >= 2) return DENSE_ROW_EXTRA_FOOTPRINT_PX;
  return 0;
}

function getBranchLaneGutter(leftContourDepths: number, rightContourDepths: number) {
  return leftContourDepths > 1 || rightContourDepths > 1 ? BRANCH_LANE_GUTTER_PX : 0;
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
  const visibleChildrenOf = new Map<string, string[]>();

  function walk(nodeId: string): TreeLayout {
    const primaryChildren = primaryChildrenOf.get(nodeId) || [];
    if (!visibleExpanded.has(nodeId) || primaryChildren.length === 0) {
      layouts.set(nodeId, FALLBACK_LAYOUT);
      return FALLBACK_LAYOUT;
    }

    visibleChildrenOf.set(nodeId, primaryChildren);
    const childLayouts = primaryChildren.map((childId) => ({ childId, layout: walk(childId) }));
    const siblingGap = getSiblingGap(primaryChildren.length);

    const placedChildren: Array<{ childId: string; layout: TreeLayout; center: number }> = [];
    const occupiedRightContour: number[] = [];

    childLayouts.forEach(({ childId, layout }, index) => {
      let center = 0;

      if (index > 0) {
        const previousChild = placedChildren[index - 1];
        const branchLaneGutter = getBranchLaneGutter(previousChild.layout.rightContour.length, layout.leftContour.length);
        const fallbackCenter = previousChild.center + previousChild.layout.slotRight + siblingGap + (BRANCH_FORCE_FIELD_PX * 2) + branchLaneGutter + layout.slotLeft;
        center = occupiedRightContour.reduce((minimumCenter, rightAtDepth, depth) => {
          const leftAtDepth = layout.leftContour[depth];
          if (rightAtDepth === undefined || leftAtDepth === undefined) return minimumCenter;
          const branchLaneGutterAtDepth = getBranchLaneGutter(occupiedRightContour.length, layout.leftContour.length);
          return Math.max(
            minimumCenter,
            rightAtDepth + siblingGap + (BRANCH_FORCE_FIELD_PX * 2) + branchLaneGutterAtDepth - leftAtDepth,
          );
        }, fallbackCenter);
      }

      placedChildren.push({ childId, layout, center });
      layout.rightContour.forEach((rightAtDepth, depth) => {
        const absoluteRight = center + rightAtDepth;
        occupiedRightContour[depth] = occupiedRightContour[depth] === undefined
          ? absoluteRight
          : Math.max(occupiedRightContour[depth]!, absoluteRight);
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
      slotWidth: CARD_WIDTH_PX,
      slotLeft: CARD_WIDTH_PX / 2,
      slotRight: CARD_WIDTH_PX / 2,
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
  return applyLevelAwareSpacing(rootId, visibleChildrenOf, layouts);
}

function applyLevelAwareSpacing(
  rootId: string,
  visibleChildrenOf: Map<string, string[]>,
  baseLayouts: Map<string, TreeLayout>,
): Map<string, TreeLayout> {
  const absoluteCenters = new Map<string, number>();
  const nodesByDepth = new Map<number, string[]>();
  const subtreeNodes = new Map<string, string[]>();

  function assignAbsoluteCenters(nodeId: string, absoluteCenter: number, depth: number) {
    absoluteCenters.set(nodeId, absoluteCenter);
    if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
    nodesByDepth.get(depth)!.push(nodeId);

    const layout = baseLayouts.get(nodeId) ?? FALLBACK_LAYOUT;
    const subtreeMinX = absoluteCenter - layout.center;

    for (const childId of visibleChildrenOf.get(nodeId) || []) {
      const childCenter = layout.childCenters.get(childId) ?? layout.center;
      assignAbsoluteCenters(childId, subtreeMinX + childCenter, depth + 1);
    }
  }

  function collectSubtreeNodes(nodeId: string): string[] {
    const ids = [nodeId];
    for (const childId of visibleChildrenOf.get(nodeId) || []) {
      ids.push(...collectSubtreeNodes(childId));
    }
    subtreeNodes.set(nodeId, ids);
    return ids;
  }

  assignAbsoluteCenters(rootId, 0, 0);
  collectSubtreeNodes(rootId);

  for (const depth of [...nodesByDepth.keys()].sort((a, b) => a - b)) {
    const sortedNodeIds = [...nodesByDepth.get(depth)!].sort(
      (a, b) => absoluteCenters.get(a)! - absoluteCenters.get(b)! || a.localeCompare(b),
    );
    const rowFootprint = CARD_WIDTH_PX + (NODE_FORCE_FIELD_PX * 2) + getDenseRowExtraFootprint(sortedNodeIds.length);
    const halfRowFootprint = rowFootprint / 2;

    let previousRightEdge = Number.NEGATIVE_INFINITY;

    for (const nodeId of sortedNodeIds) {
      const center = absoluteCenters.get(nodeId)!;
      const leftEdge = center - halfRowFootprint;
      const minimumLeftEdge = previousRightEdge === Number.NEGATIVE_INFINITY
        ? leftEdge
        : previousRightEdge + LEVEL_GAP_PX;

      if (leftEdge < minimumLeftEdge) {
        const shift = minimumLeftEdge - leftEdge;
        for (const subtreeNodeId of subtreeNodes.get(nodeId) || [nodeId]) {
          absoluteCenters.set(subtreeNodeId, absoluteCenters.get(subtreeNodeId)! + shift);
        }
      }

      previousRightEdge = absoluteCenters.get(nodeId)! + halfRowFootprint;
    }
  }

  function shiftSubtree(nodeId: string, shift: number) {
    if (shift <= 0) return;
    for (const subtreeNodeId of subtreeNodes.get(nodeId) || [nodeId]) {
      absoluteCenters.set(subtreeNodeId, absoluteCenters.get(subtreeNodeId)! + shift);
    }
  }

  function measureSubtree(nodeId: string): {
    minX: number;
    maxX: number;
    leftContour: number[];
    rightContour: number[];
  } {
    const nodeCenter = absoluteCenters.get(nodeId) ?? 0;
    const childIds = visibleChildrenOf.get(nodeId) || [];
    const leftContour = [nodeCenter - (CARD_WIDTH_PX / 2)];
    const rightContour = [nodeCenter + (CARD_WIDTH_PX / 2)];
    let minX = leftContour[0]!;
    let maxX = rightContour[0]!;

    for (const childId of childIds) {
      const childMeasurement = measureSubtree(childId);
      minX = Math.min(minX, childMeasurement.minX);
      maxX = Math.max(maxX, childMeasurement.maxX);

      childMeasurement.leftContour.forEach((leftAtDepth, depth) => {
        const parentDepth = depth + 1;
        leftContour[parentDepth] = leftContour[parentDepth] === undefined
          ? leftAtDepth
          : Math.min(leftContour[parentDepth]!, leftAtDepth);
      });

      childMeasurement.rightContour.forEach((rightAtDepth, depth) => {
        const parentDepth = depth + 1;
        rightContour[parentDepth] = rightContour[parentDepth] === undefined
          ? rightAtDepth
          : Math.max(rightContour[parentDepth]!, rightAtDepth);
      });
    }

    return {
      minX,
      maxX,
      leftContour,
      rightContour,
    };
  }

  function resolveSiblingSubtreeOverlaps(nodeId: string) {
    const childIds = [...(visibleChildrenOf.get(nodeId) || [])].sort(
      (a, b) => absoluteCenters.get(a)! - absoluteCenters.get(b)! || a.localeCompare(b),
    );

    childIds.forEach((childId) => resolveSiblingSubtreeOverlaps(childId));

    if (childIds.length <= 1) return;

    const siblingGap = getSiblingGap(childIds.length);
    const occupiedRightContour: number[] = [];

    childIds.forEach((childId, index) => {
      let measurement = measureSubtree(childId);

      if (index > 0) {
        const branchLaneGutter = getBranchLaneGutter(occupiedRightContour.length, measurement.leftContour.length);
        const shift = occupiedRightContour.reduce((requiredShift, rightAtDepth, depth) => {
          const leftAtDepth = measurement.leftContour[depth];
          if (rightAtDepth === undefined || leftAtDepth === undefined) return requiredShift;
          return Math.max(
            requiredShift,
            rightAtDepth + siblingGap + (BRANCH_FORCE_FIELD_PX * 2) + branchLaneGutter - leftAtDepth,
          );
        }, 0);

        if (shift > 0) {
          shiftSubtree(childId, shift);
          measurement = measureSubtree(childId);
        }
      }

      measurement.rightContour.forEach((rightAtDepth, depth) => {
        occupiedRightContour[depth] = occupiedRightContour[depth] === undefined
          ? rightAtDepth
          : Math.max(occupiedRightContour[depth]!, rightAtDepth);
      });
    });
  }

  resolveSiblingSubtreeOverlaps(rootId);

  const adjustedLayouts = new Map<string, TreeLayout>();

  function rebuild(nodeId: string): {
    minX: number;
    maxX: number;
    leftContour: number[];
    rightContour: number[];
  } {
    const nodeCenter = absoluteCenters.get(nodeId) ?? 0;
    const childIds = visibleChildrenOf.get(nodeId) || [];
    const leftContour = [nodeCenter - (CARD_WIDTH_PX / 2)];
    const rightContour = [nodeCenter + (CARD_WIDTH_PX / 2)];
    let minX = leftContour[0]!;
    let maxX = rightContour[0]!;

    for (const childId of childIds) {
      const childBounds = rebuild(childId);
      minX = Math.min(minX, childBounds.minX);
      maxX = Math.max(maxX, childBounds.maxX);

      childBounds.leftContour.forEach((leftAtDepth, depth) => {
        const parentDepth = depth + 1;
        leftContour[parentDepth] = leftContour[parentDepth] === undefined
          ? leftAtDepth
          : Math.min(leftContour[parentDepth]!, leftAtDepth);
      });

      childBounds.rightContour.forEach((rightAtDepth, depth) => {
        const parentDepth = depth + 1;
        rightContour[parentDepth] = rightContour[parentDepth] === undefined
          ? rightAtDepth
          : Math.max(rightContour[parentDepth]!, rightAtDepth);
      });
    }

    const center = nodeCenter - minX;
    const width = maxX - minX;
    const left = center;
    const right = maxX - nodeCenter;
    const childCenters = new Map(
      childIds.map((childId) => [childId, (absoluteCenters.get(childId) ?? nodeCenter) - minX]),
    );

    adjustedLayouts.set(nodeId, {
      width,
      center,
      left,
      right,
      slotWidth: CARD_WIDTH_PX,
      slotLeft: CARD_WIDTH_PX / 2,
      slotRight: CARD_WIDTH_PX / 2,
      childCenters,
      leftContour: leftContour.map((value) => value - nodeCenter),
      rightContour: rightContour.map((value) => value - nodeCenter),
    });

    return {
      minX,
      maxX,
      leftContour,
      rightContour,
    };
  }

  rebuild(rootId);
  return adjustedLayouts;
}

export function computeVisibleNodeCentersByDepth(
  rootId: string,
  edges: FlowLayoutEdge[],
  primaryParents: Map<string, string>,
  treeLayouts: Map<string, TreeLayout>,
  expandedNodeIds: Set<string>,
  expandedOverrides: Set<string>,
): Map<number, number[]> {
  const primaryChildrenOf = new Map<string, string[]>();
  const sortedEdges = [...edges].sort((a, b) => a.sortOrder - b.sortOrder);
  const visibleExpanded = new Set([...expandedNodeIds, ...expandedOverrides]);

  for (const edge of sortedEdges) {
    if (primaryParents.get(edge.targetNodeId) !== edge.sourceNodeId) continue;
    if (!primaryChildrenOf.has(edge.sourceNodeId)) primaryChildrenOf.set(edge.sourceNodeId, []);
    primaryChildrenOf.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }

  const centersByDepth = new Map<number, number[]>();

  function walk(nodeId: string, absoluteCenter: number, depth: number) {
    if (!centersByDepth.has(depth)) centersByDepth.set(depth, []);
    centersByDepth.get(depth)!.push(absoluteCenter);

    const layout = treeLayouts.get(nodeId) ?? FALLBACK_LAYOUT;
    const subtreeMinX = absoluteCenter - layout.center;

    if (!visibleExpanded.has(nodeId)) return;

    for (const childId of primaryChildrenOf.get(nodeId) || []) {
      const childCenter = layout.childCenters.get(childId);
      if (childCenter === undefined) continue;
      walk(childId, subtreeMinX + childCenter, depth + 1);
    }
  }

  walk(rootId, 0, 0);

  for (const [depth, centers] of centersByDepth) {
    centersByDepth.set(depth, centers.sort((a, b) => a - b));
  }

  return centersByDepth;
}

export function computeVisibleTreeMap(
  rootId: string,
  edges: FlowLayoutEdge[],
  primaryParents: Map<string, string>,
  treeLayouts: Map<string, TreeLayout>,
  expandedNodeIds: Set<string>,
  expandedOverrides: Set<string>,
): VisibleTreeMap {
  const primaryChildEdgesOf = new Map<string, FlowLayoutEdge[]>();
  const sortedEdges = [...edges].sort((a, b) => a.sortOrder - b.sortOrder);
  const visibleExpanded = new Set([...expandedNodeIds, ...expandedOverrides]);

  for (const edge of sortedEdges) {
    if (primaryParents.get(edge.targetNodeId) !== edge.sourceNodeId) continue;
    if (!primaryChildEdgesOf.has(edge.sourceNodeId)) primaryChildEdgesOf.set(edge.sourceNodeId, []);
    primaryChildEdgesOf.get(edge.sourceNodeId)!.push(edge);
  }

  const nodes: VisibleTreeNodePlacement[] = [];
  const rows = new Map<number, VisibleTreeNodePlacement[]>();
  let maxDepth = 0;

  function walk(
    nodeId: string,
    centerX: number,
    depth: number,
    parentId: string | null,
    incomingEdge: FlowLayoutEdge | null,
  ) {
    const placement: VisibleTreeNodePlacement = {
      nodeId,
      depth,
      centerX,
      parentId,
      incomingEdge,
    };

    nodes.push(placement);
    if (!rows.has(depth)) rows.set(depth, []);
    rows.get(depth)!.push(placement);
    maxDepth = Math.max(maxDepth, depth);

    if (!visibleExpanded.has(nodeId)) return;

    const layout = treeLayouts.get(nodeId) ?? FALLBACK_LAYOUT;
    const subtreeMinX = centerX - layout.center;

    for (const edge of primaryChildEdgesOf.get(nodeId) || []) {
      const childCenter = layout.childCenters.get(edge.targetNodeId);
      if (childCenter === undefined) continue;
      walk(edge.targetNodeId, subtreeMinX + childCenter, depth + 1, nodeId, edge);
    }
  }

  const rootLayout = treeLayouts.get(rootId) ?? FALLBACK_LAYOUT;
  walk(rootId, rootLayout.center, 0, null, null);

  for (const [depth, rowPlacements] of rows) {
    rows.set(depth, rowPlacements.sort((a, b) => a.centerX - b.centerX || a.nodeId.localeCompare(b.nodeId)));
  }

  return {
    nodes: nodes.sort((a, b) => a.depth - b.depth || a.centerX - b.centerX || a.nodeId.localeCompare(b.nodeId)),
    rows,
    maxDepth,
  };
}

export function computeVirtualTreeRenderModel(
  rootId: string,
  nodes: FlowLayoutNode[],
  edges: FlowLayoutEdge[],
  primaryParents: Map<string, string>,
  treeLayouts: Map<string, TreeLayout>,
  expandedNodeIds: Set<string>,
  expandedOverrides: Set<string>,
  options: VirtualTreeRenderOptions = {},
): VirtualTreeRenderModel {
  const {
    rootHeaderHeight = VIRTUAL_ROOT_HEADER_HEIGHT_PX,
    rowHeight = VIRTUAL_TREE_ROW_HEIGHT_PX,
    nodeTop = VIRTUAL_TREE_NODE_TOP_PX,
    labeledNodeTop = VIRTUAL_TREE_NODE_TOP_WITH_LABEL_PX,
    cardHeight = VIRTUAL_TREE_CARD_HEIGHT_PX,
  } = options;
  const visibleTree = computeVisibleTreeMap(
    rootId,
    edges,
    primaryParents,
    treeLayouts,
    expandedNodeIds,
    expandedOverrides,
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeBoxes = new Map<string, VirtualTreeNodeBox>();
  const branchSlices = new Map<string, VirtualTreeBranchSlice[]>();

  for (const placement of visibleTree.nodes) {
    const node = nodeById.get(placement.nodeId);
    const parentNode = placement.parentId ? nodeById.get(placement.parentId) : null;
    const branchLabel = !placement.parentId || !placement.incomingEdge || node?.type === 'response'
      ? null
      : placement.incomingEdge.label
        || placement.incomingEdge.condition
        || (parentNode?.type === 'question' ? node?.config?.response ?? null : null);
    const stackTop = rootHeaderHeight + (placement.depth * rowHeight) + (branchLabel ? labeledNodeTop : nodeTop);

    nodeBoxes.set(placement.nodeId, {
      nodeId: placement.nodeId,
      depth: placement.depth,
      left: placement.centerX - (CARD_WIDTH_PX / 2),
      right: placement.centerX + (CARD_WIDTH_PX / 2),
      top: stackTop,
      bottom: stackTop + cardHeight,
    });

    const layout = treeLayouts.get(placement.nodeId) ?? FALLBACK_LAYOUT;
    branchSlices.set(placement.nodeId, layout.leftContour.map((leftAtDepth, depthOffset) => ({
      ownerNodeId: placement.nodeId,
      absoluteDepth: placement.depth + depthOffset,
      left: placement.centerX + leftAtDepth,
      right: placement.centerX + (layout.rightContour[depthOffset] ?? CARD_WIDTH_PX / 2),
    })));
  }

  return {
    visibleTree,
    nodeBoxes,
    branchSlices,
  };
}

export function findVirtualNodeOverlaps(
  renderModel: VirtualTreeRenderModel,
  minimumGap = 0,
): VirtualNodeOverlap[] {
  const overlaps: VirtualNodeOverlap[] = [];

  for (const [depth, placements] of renderModel.visibleTree.rows) {
    for (let index = 1; index < placements.length; index += 1) {
      const leftNode = placements[index - 1]!;
      const rightNode = placements[index]!;
      const leftBox = renderModel.nodeBoxes.get(leftNode.nodeId);
      const rightBox = renderModel.nodeBoxes.get(rightNode.nodeId);
      if (!leftBox || !rightBox) continue;

      const gap = rightBox.left - leftBox.right;
      if (gap < minimumGap) {
        overlaps.push({
          leftNodeId: leftNode.nodeId,
          rightNodeId: rightNode.nodeId,
          depth,
          overlap: minimumGap - gap,
        });
      }
    }
  }

  return overlaps;
}

export function findVirtualBranchOverlaps(
  renderModel: VirtualTreeRenderModel,
  minimumGap = 0,
): VirtualBranchOverlap[] {
  const overlaps: VirtualBranchOverlap[] = [];
  const childrenByParent = new Map<string, VisibleTreeNodePlacement[]>();

  for (const placement of renderModel.visibleTree.nodes) {
    if (!placement.parentId) continue;
    if (!childrenByParent.has(placement.parentId)) childrenByParent.set(placement.parentId, []);
    childrenByParent.get(placement.parentId)!.push(placement);
  }

  for (const [parentId, placements] of childrenByParent) {
    const sortedPlacements = [...placements].sort(
      (a, b) => a.centerX - b.centerX || a.nodeId.localeCompare(b.nodeId),
    );

    for (let index = 1; index < sortedPlacements.length; index += 1) {
      const leftPlacement = sortedPlacements[index - 1]!;
      const rightPlacement = sortedPlacements[index]!;
      const leftSlices = renderModel.branchSlices.get(leftPlacement.nodeId) ?? [];
      const rightSlices = renderModel.branchSlices.get(rightPlacement.nodeId) ?? [];
      const rightSliceByDepth = new Map(rightSlices.map((slice) => [slice.absoluteDepth, slice]));

      for (const leftSlice of leftSlices) {
        const rightSlice = rightSliceByDepth.get(leftSlice.absoluteDepth);
        if (!rightSlice) continue;

        const gap = rightSlice.left - leftSlice.right;
        if (gap < minimumGap) {
          overlaps.push({
            parentId,
            leftNodeId: leftPlacement.nodeId,
            rightNodeId: rightPlacement.nodeId,
            absoluteDepth: leftSlice.absoluteDepth,
            overlap: minimumGap - gap,
          });
        }
      }
    }
  }

  return overlaps;
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

  const start = Math.min(...placements.map((placement) => placement.childCenter - (CARD_WIDTH_PX / 2)));
  const end = Math.max(...placements.map((placement) => placement.childCenter + (CARD_WIDTH_PX / 2)));

  return {
    start,
    end,
    width: Math.max(end - start, 1),
  };
}

export function getConnectorSpanFromBounds(
  bounds: Array<{ left: number; right: number }>,
  fallbackCenter: number,
) {
  if (bounds.length === 0) {
    return { start: fallbackCenter, end: fallbackCenter, width: 1 };
  }

  const start = Math.min(...bounds.map((bound) => bound.left));
  const end = Math.max(...bounds.map((bound) => bound.right));

  return {
    start,
    end,
    width: Math.max(end - start, 1),
  };
}
