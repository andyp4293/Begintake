import { describe, expect, it } from 'vitest';
import {
  clampCameraToBoard,
  getCameraForNodeFocus,
  getCanvasMetrics,
} from '@/lib/flow-tree-canvas';

describe('flow tree canvas', () => {
  it('adds viewport-sized camera margins so the board can pan around the tree', () => {
    const metrics = getCanvasMetrics({
      viewportWidth: 1600,
      viewportHeight: 900,
      contentWidth: 2200,
      contentHeight: 1800,
      paddingX: 240,
      paddingTop: 112,
      paddingBottom: 180,
    });

    expect(metrics.cameraMarginX).toBe(800);
    expect(metrics.cameraMarginY).toBe(315);
    expect(metrics.contentOffsetX).toBe(1040);
    expect(metrics.contentOffsetY).toBe(427);
    expect(metrics.boardWidth).toBe(4280);
    expect(metrics.boardHeight).toBe(2722);
  });

  it('can center a root node that sits near the left side of an asymmetric tree', () => {
    const metrics = getCanvasMetrics({
      viewportWidth: 1600,
      viewportHeight: 900,
      contentWidth: 2200,
      contentHeight: 1800,
      paddingX: 240,
      paddingTop: 112,
      paddingBottom: 180,
    });

    const camera = getCameraForNodeFocus({
      viewportWidth: 1600,
      viewportHeight: 900,
      nodeCenterX: metrics.contentOffsetX + 280,
      nodeCenterY: metrics.contentOffsetY + 96,
      boardWidth: metrics.boardWidth,
      boardHeight: metrics.boardHeight,
    });

    expect(camera.x).toBe(-520);
    expect((metrics.contentOffsetX + 280) + camera.x).toBe(800);
  });

  it('keeps camera movement finite while still allowing large pans in both directions', () => {
    const clamped = clampCameraToBoard(
      { x: 400, y: -4000 },
      1600,
      900,
      4280,
      2722,
    );

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(-1822);
  });
});
