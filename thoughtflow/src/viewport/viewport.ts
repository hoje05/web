import { clamp, type Vec } from '../geometry/vec';
import type { Viewport } from '../model/types';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const screenToWorld = (v: Viewport, p: Vec): Vec => ({ x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom });
export const worldToScreen = (v: Viewport, p: Vec): Vec => ({ x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY });

/** 화면 좌표 anchor(보통 마우스 위치)를 고정한 채 zoom 변경 */
export function zoomAt(v: Viewport, anchor: Vec, factor: number): Viewport {
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const k = zoom / v.zoom;
  return { zoom, panX: anchor.x - (anchor.x - v.panX) * k, panY: anchor.y - (anchor.y - v.panY) * k };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** world 영역 bounds 전체가 화면(size)에 들어오도록 하는 viewport */
export function fitBounds(b: Bounds, size: { width: number; height: number }, padding = 80): Viewport {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const zoom = clamp(Math.min((size.width - padding * 2) / w, (size.height - padding * 2) / h), MIN_ZOOM, 1);
  return {
    zoom,
    panX: size.width / 2 - (b.minX + w / 2) * zoom,
    panY: size.height / 2 - (b.minY + h / 2) * zoom,
  };
}
