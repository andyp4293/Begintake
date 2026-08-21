import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH_PX,
  BRANCH_FORCE_FIELD_PX,
  BRANCH_LANE_GUTTER_PX,
  CHILD_GAP_PX,
  DENSE_ROW_EXTRA_FOOTPRINT_PX,
  LEVEL_GAP_PX,
  MIN_VISIBLE_NODE_CLEARANCE_PX,
  NODE_FORCE_FIELD_PX,
  computeVirtualTreeRenderModel,
  computePrimaryParents,
  computeVisibleNodeCentersByDepth,
  computeVisibleTreeLayouts,
  findVirtualBranchOverlaps,
  findVirtualNodeOverlaps,
  getDenseRowExtraFootprint,
  getConnectorSpan,
  getConnectorSpanFromBounds,
  getPrimaryChildPlacements,
  getSiblingGap,
  type FlowLayoutEdge,
} from '@/lib/flow-tree-layout';
import { createDefaultIntakeTemplate } from '@/lib/templates/default-intake';
import { createGeneralIntakeTemplate } from '@/lib/templates/general-intake';

function makeEdge(sourceNodeId: string, targetNodeId: string, sortOrder: number): FlowLayoutEdge {
  return {
    sourceNodeId,
    targetNodeId,
    label: null,
    condition: null,
    sortOrder,
  };
}

function computeAbsoluteCenters(
  rootId: string,
  edges: FlowLayoutEdge[],
  primaryParents: Map<string, string>,
  layouts: Map<string, { center: number; childCenters: Map<string, number> }>,
) {
  const primaryChildrenOf = new Map<string, string[]>();

  for (const edge of [...edges].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (primaryParents.get(edge.targetNodeId) !== edge.sourceNodeId) continue;
    if (!primaryChildrenOf.has(edge.sourceNodeId)) primaryChildrenOf.set(edge.sourceNodeId, []);
    primaryChildrenOf.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }

  const absoluteCenters = new Map<string, number>();

  function walk(nodeId: string, absoluteCenter: number) {
    absoluteCenters.set(nodeId, absoluteCenter);
    const layout = layouts.get(nodeId);
    if (!layout) return;
    const subtreeMinX = absoluteCenter - layout.center;

    for (const childId of primaryChildrenOf.get(nodeId) || []) {
      const childCenter = layout.childCenters.get(childId);
      if (childCenter === undefined) continue;
      walk(childId, subtreeMinX + childCenter);
    }
  }

  walk(rootId, 0);
  return absoluteCenters;
}

describe('flow tree layout', () => {
  it('orders rendered primary children by layout position instead of incoming edge order', () => {
    const edges = [
      makeEdge('root', 'right', 20),
      makeEdge('root', 'left', 10),
    ];
    const primaryParents = computePrimaryParents('root', edges);
    const layouts = computeVisibleTreeLayouts('root', edges, primaryParents, new Set(['root']), new Set());
    const placements = getPrimaryChildPlacements('root', edges, primaryParents, layouts);
    const connectorSpan = getConnectorSpan(placements, layouts.get('root')!.center);

    expect(placements.map((placement) => placement.childId)).toEqual(['left', 'right']);
    expect(connectorSpan.start).toBe(placements[0].childCenter - (CARD_WIDTH_PX / 2));
    expect(connectorSpan.end).toBe(placements[1].childCenter + (CARD_WIDTH_PX / 2));
    expect(connectorSpan.width).toBe((placements[1].childCenter - placements[0].childCenter) + CARD_WIDTH_PX);
  });

  it('uses a larger sibling gap for wide decisions so neighboring cards do not overlap', () => {
    const edges = Array.from({ length: 5 }, (_, index) => makeEdge('root', `child-${index}`, index));
    const primaryParents = computePrimaryParents('root', edges);
    const layouts = computeVisibleTreeLayouts('root', edges, primaryParents, new Set(['root']), new Set());
    const placements = getPrimaryChildPlacements('root', edges, primaryParents, layouts);
    const expectedGap = CARD_WIDTH_PX + getSiblingGap(edges.length) + (BRANCH_FORCE_FIELD_PX * 2);

    expect(getSiblingGap(2)).toBe(CHILD_GAP_PX);
    expect(getSiblingGap(edges.length)).toBe(52);
    expect(placements).toHaveLength(5);

    const centerDiffs = placements.slice(1).map((placement, index) => placement.childCenter - placements[index].childCenter);
    const denseRowExpectedGap = CARD_WIDTH_PX + (NODE_FORCE_FIELD_PX * 2) + getDenseRowExtraFootprint(edges.length) + LEVEL_GAP_PX;
    expect(centerDiffs.every((diff) => diff === Math.max(expectedGap, denseRowExpectedGap))).toBe(true);
  });

  it('widens the visible layout when an expanded child reveals a large fan-out', () => {
    const edges = [
      makeEdge('root', 'stable-leaf', 0),
      makeEdge('root', 'branch-root', 1),
      makeEdge('branch-root', 'branch-a', 0),
      makeEdge('branch-root', 'branch-b', 1),
      makeEdge('branch-root', 'branch-c', 2),
      makeEdge('branch-root', 'branch-d', 3),
      makeEdge('branch-root', 'branch-e', 4),
      makeEdge('branch-root', 'branch-f', 5),
    ];

    const primaryParents = computePrimaryParents('root', edges);
    const collapsedLayouts = computeVisibleTreeLayouts('root', edges, primaryParents, new Set(['root']), new Set());
    const expandedLayouts = computeVisibleTreeLayouts('root', edges, primaryParents, new Set(['root', 'branch-root']), new Set());

    expect(expandedLayouts.get('branch-root')!.width).toBeGreaterThan(collapsedLayouts.get('branch-root')!.width);
    expect(expandedLayouts.get('root')!.width).toBeGreaterThan(collapsedLayouts.get('root')!.width);
  });

  it('still keeps upper-level siblings separated by at least one card width when one branch expands deeply', () => {
    const edges = [
      makeEdge('root', 'left', 0),
      makeEdge('root', 'right', 1),
      makeEdge('left', 'left-branch-root', 0),
      makeEdge('left-branch-root', 'left-a', 0),
      makeEdge('left-branch-root', 'left-b', 1),
      makeEdge('left-branch-root', 'left-c', 2),
      makeEdge('left-branch-root', 'left-d', 3),
      makeEdge('left-branch-root', 'left-e', 4),
      makeEdge('left-branch-root', 'left-f', 5),
    ];

    const primaryParents = computePrimaryParents('root', edges);
    const expanded = new Set(['root', 'left', 'left-branch-root']);
    const layouts = computeVisibleTreeLayouts('root', edges, primaryParents, expanded, new Set());
    const placements = getPrimaryChildPlacements('root', edges, primaryParents, layouts);

    expect(placements).toHaveLength(2);
    expect(placements[1].childCenter - placements[0].childCenter - CARD_WIDTH_PX).toBeGreaterThanOrEqual(MIN_VISIBLE_NODE_CLEARANCE_PX);
  });

  it('pushes adjacent upper branches farther apart when both reveal wide child rows', () => {
    const edges = [
      makeEdge('root', 'left', 0),
      makeEdge('root', 'right', 1),
      makeEdge('left', 'left-a', 0),
      makeEdge('left', 'left-b', 1),
      makeEdge('left', 'left-c', 2),
      makeEdge('left', 'left-d', 3),
      makeEdge('right', 'right-a', 0),
      makeEdge('right', 'right-b', 1),
      makeEdge('right', 'right-c', 2),
      makeEdge('right', 'right-d', 3),
    ];

    const primaryParents = computePrimaryParents('root', edges);
    const expanded = new Set(['root', 'left', 'right']);
    const layouts = computeVisibleTreeLayouts('root', edges, primaryParents, expanded, new Set());
    const placements = getPrimaryChildPlacements('root', edges, primaryParents, layouts);

    expect(placements).toHaveLength(2);
    expect(placements[1].childCenter - placements[0].childCenter).toBeGreaterThan(CARD_WIDTH_PX + LEVEL_GAP_PX);
  });

  it('keeps visible nodes on the same depth from overlapping even across different branches', () => {
    const edges = [
      makeEdge('root', 'left', 0),
      makeEdge('root', 'right', 1),
      makeEdge('left', 'left-a', 0),
      makeEdge('left', 'left-b', 1),
      makeEdge('right', 'right-a', 0),
      makeEdge('right', 'right-b', 1),
      makeEdge('left-a', 'left-a-1', 0),
      makeEdge('left-b', 'left-b-1', 0),
      makeEdge('right-a', 'right-a-1', 0),
      makeEdge('right-b', 'right-b-1', 0),
    ];

    const primaryParents = computePrimaryParents('root', edges);
    const expanded = new Set(['root', 'left', 'right', 'left-a', 'left-b', 'right-a', 'right-b']);
    const layouts = computeVisibleTreeLayouts('root', edges, primaryParents, expanded, new Set());
    const centersByDepth = computeVisibleNodeCentersByDepth('root', edges, primaryParents, layouts, expanded, new Set());

    for (const centers of centersByDepth.values()) {
      const diffs = centers.slice(1).map((center, index) => center - centers[index]);
      const denseRowFootprint = CARD_WIDTH_PX + (NODE_FORCE_FIELD_PX * 2) + getDenseRowExtraFootprint(centers.length);
      expect(diffs.every((diff) => diff >= denseRowFootprint + LEVEL_GAP_PX)).toBe(true);
    }
  });

  it('adds extra separation for dense same-depth rows so visible branches do not crowd together', () => {
    const edges = [
      makeEdge('root', 'left', 0),
      makeEdge('root', 'right', 1),
      makeEdge('left', 'left-a', 0),
      makeEdge('left', 'left-b', 1),
      makeEdge('right', 'right-a', 0),
      makeEdge('right', 'right-b', 1),
    ];

    const primaryParents = computePrimaryParents('root', edges);
    const expanded = new Set(['root', 'left', 'right']);
    const layouts = computeVisibleTreeLayouts('root', edges, primaryParents, expanded, new Set());
    const centersByDepth = computeVisibleNodeCentersByDepth('root', edges, primaryParents, layouts, expanded, new Set());
    const denseRowCenters = centersByDepth.get(2)!;
    const diffs = denseRowCenters.slice(1).map((center, index) => center - denseRowCenters[index]);

    expect(denseRowCenters).toHaveLength(4);
    expect(diffs.every((diff) => diff >= CARD_WIDTH_PX + (NODE_FORCE_FIELD_PX * 2) + DENSE_ROW_EXTRA_FOOTPRINT_PX + LEVEL_GAP_PX)).toBe(true);
  });

  it('gives the default intake template wider breathing room on extremely dense repeated response rows', () => {
    const template = createDefaultIntakeTemplate();
    const root = template.nodes.find((node: any) => !template.edges.some((edge: any) => edge.targetNodeId === node.id));
    const primaryParents = computePrimaryParents(root.id, template.edges);
    const expanded = new Set(template.nodes.map((node: any) => node.id));
    const layouts = computeVisibleTreeLayouts(root.id, template.edges, primaryParents, expanded, new Set());
    const centersByDepth = computeVisibleNodeCentersByDepth(root.id, template.edges, primaryParents, layouts, expanded, new Set());
    const repeatedResponseRow = centersByDepth.get(17)!;
    const minGap = repeatedResponseRow.slice(1).reduce(
      (smallestGap, center, index) => Math.min(smallestGap, center - repeatedResponseRow[index]),
      Number.POSITIVE_INFINITY,
    );

    expect(repeatedResponseRow).toHaveLength(42);
    expect(minGap - CARD_WIDTH_PX).toBeGreaterThanOrEqual(MIN_VISIBLE_NODE_CLEARANCE_PX);
    expect(minGap).toBeGreaterThan(
      CARD_WIDTH_PX + DENSE_ROW_EXTRA_FOOTPRINT_PX + LEVEL_GAP_PX,
    );
    expect(minGap).toBeGreaterThanOrEqual(
      CARD_WIDTH_PX + getDenseRowExtraFootprint(repeatedResponseRow.length) + LEVEL_GAP_PX,
    );
  });

  it('keeps dense corporate and real estate routing rows from collapsing into each other in the general intake template', () => {
    const template = createGeneralIntakeTemplate();
    const root = template.nodes.find((node: any) => !template.edges.some((edge: any) => edge.targetNodeId === node.id));
    const primaryParents = computePrimaryParents(root.id, template.edges);
    const expanded = new Set(template.nodes
      .filter((node: any) => !node.config?.defaultCollapsed)
      .map((node: any) => node.id));

    ['Corporate - Matter Type', 'Real Estate - Matter Type'].forEach((label) => {
      const node = template.nodes.find((candidate: any) => candidate.label === label);
      if (node) expanded.add(node.id);
    });

    const layouts = computeVisibleTreeLayouts(root.id, template.edges, primaryParents, expanded, new Set());
    const absoluteCenters = computeAbsoluteCenters(root.id, template.edges, primaryParents, layouts);
    const corpOther = template.nodes.find((node: any) => node.label === 'Other business or corporate matter');
    const realEstatePurchase = template.nodes.find((node: any) => node.label === 'Buying a property (purchase or closing)');

    expect(corpOther).toBeTruthy();
    expect(realEstatePurchase).toBeTruthy();

    const corpCenter = absoluteCenters.get(corpOther!.id)!;
    const realEstateCenter = absoluteCenters.get(realEstatePurchase!.id)!;

    expect(realEstateCenter - corpCenter - CARD_WIDTH_PX).toBeGreaterThanOrEqual(BRANCH_LANE_GUTTER_PX);
  });

  it('extends the default intake branching trunk across the visible child cards', () => {
    const template = createDefaultIntakeTemplate();
    const root = template.nodes.find((node: any) => !template.edges.some((edge: any) => edge.targetNodeId === node.id));
    const primaryParents = computePrimaryParents(root.id, template.edges);
    const expanded = new Set(template.nodes.map((node: any) => node.id));
    const layouts = computeVisibleTreeLayouts(root.id, template.edges, primaryParents, expanded, new Set());
    const q4 = template.nodes.find((node: any) => node.label === 'Q4. New or Existing Client');
    const childEdges = template.edges.filter((edge: any) => edge.sourceNodeId === q4.id);
    const placements = getPrimaryChildPlacements(q4.id, childEdges, primaryParents, layouts);
    const connectorSpan = getConnectorSpan(placements, layouts.get(q4.id)!.center);

    expect(placements).toHaveLength(2);
    expect(connectorSpan.start).toBe(placements[0].childCenter - (CARD_WIDTH_PX / 2));
    expect(connectorSpan.end).toBe(placements[1].childCenter + (CARD_WIDTH_PX / 2));
    expect(connectorSpan.width).toBe((placements[1].childCenter - placements[0].childCenter) + CARD_WIDTH_PX);
  });

  it('virtual render model keeps fully expanded default intake branch envelopes separated', () => {
    const template = createDefaultIntakeTemplate();
    const root = template.nodes.find((node: any) => !template.edges.some((edge: any) => edge.targetNodeId === node.id));
    const primaryParents = computePrimaryParents(root.id, template.edges);
    const expanded = new Set(template.nodes.map((node: any) => node.id));
    const layouts = computeVisibleTreeLayouts(root.id, template.edges, primaryParents, expanded, new Set());
    const renderModel = computeVirtualTreeRenderModel(
      root.id,
      template.nodes,
      template.edges,
      primaryParents,
      layouts,
      expanded,
      new Set(),
    );

    expect(findVirtualNodeOverlaps(renderModel, NODE_FORCE_FIELD_PX * 2)).toEqual([]);
    expect(findVirtualBranchOverlaps(renderModel, BRANCH_FORCE_FIELD_PX * 2)).toEqual([]);
  });

  it('keeps default intake sibling branch envelopes in distinct visual lanes when they keep descending', () => {
    const template = createDefaultIntakeTemplate();
    const root = template.nodes.find((node: any) => !template.edges.some((edge: any) => edge.targetNodeId === node.id));
    const primaryParents = computePrimaryParents(root.id, template.edges);
    const expanded = new Set(template.nodes.map((node: any) => node.id));
    const layouts = computeVisibleTreeLayouts(root.id, template.edges, primaryParents, expanded, new Set());
    const renderModel = computeVirtualTreeRenderModel(
      root.id,
      template.nodes,
      template.edges,
      primaryParents,
      layouts,
      expanded,
      new Set(),
    );
    const rightsGroup = template.nodes.find((node: any) => node.label === 'Group B. Injury, Employment, or Civil Rights');

    expect(rightsGroup).toBeTruthy();
    expect(
      findVirtualBranchOverlaps(renderModel, (BRANCH_FORCE_FIELD_PX * 2) + BRANCH_LANE_GUTTER_PX)
        .filter((overlap) => overlap.parentId === rightsGroup!.id),
    ).toEqual([]);
  });

  it('virtual render model keeps fully expanded general intake branch envelopes separated', () => {
    const template = createGeneralIntakeTemplate();
    const root = template.nodes.find((node: any) => !template.edges.some((edge: any) => edge.targetNodeId === node.id));
    const primaryParents = computePrimaryParents(root.id, template.edges);
    const expanded = new Set(template.nodes.map((node: any) => node.id));
    const layouts = computeVisibleTreeLayouts(root.id, template.edges, primaryParents, expanded, new Set());
    const renderModel = computeVirtualTreeRenderModel(
      root.id,
      template.nodes,
      template.edges,
      primaryParents,
      layouts,
      expanded,
      new Set(),
    );

    expect(findVirtualNodeOverlaps(renderModel, NODE_FORCE_FIELD_PX * 2)).toEqual([]);
    expect(findVirtualBranchOverlaps(renderModel, BRANCH_FORCE_FIELD_PX * 2)).toEqual([]);
  });

  it('can extend a connector across measured child card bounds when rendered cards sit wider than the estimate', () => {
    const measuredSpan = getConnectorSpanFromBounds([
      { left: 24, right: 296 },
      { left: 860, right: 1132 },
    ], 136);

    expect(measuredSpan.start).toBe(24);
    expect(measuredSpan.end).toBe(1132);
    expect(measuredSpan.width).toBe(1108);
  });
});
