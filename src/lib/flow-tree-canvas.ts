function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export interface CanvasMetricsInput {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface CanvasMetrics {
  boardWidth: number;
  boardHeight: number;
  contentOffsetX: number;
  contentOffsetY: number;
  cameraMarginX: number;
  cameraMarginY: number;
}

export interface Camera {
  x: number;
  y: number;
}

export function clampZoom(zoom: number, min = 0.65, max = 1.5) {
  return clamp(zoom, min, max);
}

export function getCanvasMetrics({
  viewportWidth,
  viewportHeight,
  contentWidth,
  contentHeight,
  paddingX,
  paddingTop,
  paddingBottom,
}: CanvasMetricsInput): CanvasMetrics {
  const cameraMarginX = Math.max(Math.round(viewportWidth * 0.5), 360);
  const cameraMarginY = Math.max(Math.round(viewportHeight * 0.35), 220);
  const boardWidth = Math.max(contentWidth + (paddingX * 2) + (cameraMarginX * 2), viewportWidth);
  const boardHeight = Math.max(contentHeight + paddingTop + paddingBottom + (cameraMarginY * 2), viewportHeight);

  return {
    boardWidth,
    boardHeight,
    contentOffsetX: cameraMarginX + paddingX,
    contentOffsetY: cameraMarginY + paddingTop,
    cameraMarginX,
    cameraMarginY,
  };
}

export function clampCameraToBoard(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  boardWidth: number,
  boardHeight: number,
): Camera {
  const minX = Math.min(0, viewportWidth - boardWidth);
  const minY = Math.min(0, viewportHeight - boardHeight);

  return {
    x: clamp(camera.x, minX, 0),
    y: clamp(camera.y, minY, 0),
  };
}

export interface FocusNodeCameraInput {
  viewportWidth: number;
  viewportHeight: number;
  nodeCenterX: number;
  nodeCenterY: number;
  boardWidth: number;
  boardHeight: number;
}

export function getCameraForNodeFocus({
  viewportWidth,
  viewportHeight,
  nodeCenterX,
  nodeCenterY,
  boardWidth,
  boardHeight,
}: FocusNodeCameraInput): Camera {
  return clampCameraToBoard(
    {
      x: (viewportWidth / 2) - nodeCenterX,
      y: (viewportHeight / 2) - nodeCenterY,
    },
    viewportWidth,
    viewportHeight,
    boardWidth,
    boardHeight,
  );
}

export interface ZoomCameraInput {
  camera: Camera;
  currentZoom: number;
  nextZoom: number;
  viewportWidth: number;
  viewportHeight: number;
  boardWidth: number;
  boardHeight: number;
  anchorX?: number;
  anchorY?: number;
}

export function getCameraForZoom({
  camera,
  currentZoom,
  nextZoom,
  viewportWidth,
  viewportHeight,
  boardWidth,
  boardHeight,
  anchorX = viewportWidth / 2,
  anchorY = viewportHeight / 2,
}: ZoomCameraInput): Camera {
  if (!currentZoom || !nextZoom) {
    return clampCameraToBoard(camera, viewportWidth, viewportHeight, boardWidth, boardHeight);
  }

  const worldX = (anchorX - camera.x) / currentZoom;
  const worldY = (anchorY - camera.y) / currentZoom;

  return clampCameraToBoard(
    {
      x: anchorX - (worldX * nextZoom),
      y: anchorY - (worldY * nextZoom),
    },
    viewportWidth,
    viewportHeight,
    boardWidth * nextZoom,
    boardHeight * nextZoom,
  );
}
