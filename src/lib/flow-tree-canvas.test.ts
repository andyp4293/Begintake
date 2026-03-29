import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  clampCameraToBoard,
  getCameraForZoom,
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

  it('clamps zoom levels to the supported range', () => {
    expect(clampZoom(0.2)).toBe(0.65);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(4)).toBe(1.5);
  });

  it('zooms around the current viewport center so the focused area stays put', () => {
    const nextCamera = getCameraForZoom({
      camera: { x: -520, y: -280 },
      currentZoom: 1,
      nextZoom: 1.2,
      viewportWidth: 1600,
      viewportHeight: 900,
      boardWidth: 4280,
      boardHeight: 2722,
    });

    expect(nextCamera.x).toBe(-784);
    expect(nextCamera.y).toBe(-426);
    expect(800 - nextCamera.x).toBeCloseTo((800 - (-520)) * 1.2);
    expect(450 - nextCamera.y).toBeCloseTo((450 - (-280)) * 1.2);
  });
});
