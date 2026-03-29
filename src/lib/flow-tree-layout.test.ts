import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH_PX,
  CHILD_GAP_PX,
  LEVEL_GAP_PX,
  computePrimaryParents,
  computeVisibleNodeCentersByDepth,
  computeVisibleTreeLayouts,
  getConnectorSpan,
  getPrimaryChildPlacements,
  getSiblingGap,
  type FlowLayoutEdge,
} from '@/lib/flow-tree-layout';
import { createDefaultIntakeTemplate } from '@/lib/templates/default-intake';

function makeEdge(sourceNodeId: string, targetNodeId: string, sortOrder: number): FlowLayoutEdge {
  return {
    sourceNodeId,
    targetNodeId,
    label: null,
    condition: null,
    sortOrder,
  };
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
    const expectedGap = CARD_WIDTH_PX + getSiblingGap(edges.length);

    expect(getSiblingGap(2)).toBe(CHILD_GAP_PX);
    expect(getSiblingGap(edges.length)).toBe(52);
    expect(placements).toHaveLength(5);

    const centerDiffs = placements.slice(1).map((placement, index) => placement.childCenter - placements[index].childCenter);
    expect(centerDiffs.every((diff) => diff === expectedGap)).toBe(true);
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
      expect(diffs.every((diff) => diff >= CARD_WIDTH_PX + LEVEL_GAP_PX)).toBe(true);
    }
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
    expect(connectorSpan.width).toBe(580);
  });
});
