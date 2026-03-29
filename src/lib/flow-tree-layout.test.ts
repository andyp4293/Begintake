import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH_PX,
  CHILD_GAP_PX,
  computePrimaryParents,
  computeVisibleTreeLayouts,
  getConnectorSpan,
  getPrimaryChildPlacements,
  getSiblingGap,
  type FlowLayoutEdge,
} from '@/lib/flow-tree-layout';

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
    expect(connectorSpan.start).toBe(placements[0].childCenter);
    expect(connectorSpan.end).toBe(placements[1].childCenter);
    expect(connectorSpan.width).toBe(placements[1].childCenter - placements[0].childCenter);
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
});
