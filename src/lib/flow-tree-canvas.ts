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

export function clampZoom(zoom: number, min = 0.2, max = 1.5) {
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
  const centeredX = (viewportWidth - boardWidth) / 2;
  const centeredY = (viewportHeight - boardHeight) / 2;

  return {
    x: boardWidth <= viewportWidth ? centeredX : clamp(camera.x, minX, 0),
    y: boardHeight <= viewportHeight ? centeredY : clamp(camera.y, minY, 0),
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

export interface FocusPointCameraInput {
  viewportWidth: number;
  viewportHeight: number;
  pointX: number;
  pointY: number;
  boardWidth: number;
  boardHeight: number;
  anchorX?: number;
  anchorY?: number;
}

export function getCameraForPointFocus({
  viewportWidth,
  viewportHeight,
  pointX,
  pointY,
  boardWidth,
  boardHeight,
  anchorX = viewportWidth / 2,
  anchorY = viewportHeight / 2,
}: FocusPointCameraInput): Camera {
  return clampCameraToBoard(
    {
      x: anchorX - pointX,
      y: anchorY - pointY,
    },
    viewportWidth,
    viewportHeight,
    boardWidth,
    boardHeight,
  );
}

export function getCameraForNodeFocus({
  viewportWidth,
  viewportHeight,
  nodeCenterX,
  nodeCenterY,
  boardWidth,
  boardHeight,
}: FocusNodeCameraInput): Camera {
  return getCameraForPointFocus({
    viewportWidth,
    viewportHeight,
    pointX: nodeCenterX,
    pointY: nodeCenterY,
    boardWidth,
    boardHeight,
  });
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

export function registerNonPassiveWheelListener(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  listener: (event: WheelEvent) => void,
) {
  target.addEventListener('wheel', listener as EventListener, { passive: false });
  return () => target.removeEventListener('wheel', listener as EventListener);
}
