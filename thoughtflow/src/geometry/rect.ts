import type { BoxNode, Side } from '../model/types';
import { clamp, type Vec } from './vec';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const nodeRect = (n: BoxNode): Rect => ({ x: n.x, y: n.y, width: n.width, height: n.height });
export const rectCenter = (r: Rect): Vec => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const rectContains = (r: Rect, p: Vec): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** 점이 rect 안에 있을 때 가장 가까운 테두리까지 거리 */
export function insideBorderDistance(r: Rect, p: Vec): number {
  return Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y);
}

/** 점이 rect 밖에 있을 때 rect까지의 거리 (안이면 0) */
export function outsideDistance(r: Rect, p: Vec): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** 테두리 위(또는 근처)의 점이 어느 면에 가장 가까운지 */
export function nearestSide(r: Rect, p: Vec): Side {
  const d: [Side, number][] = [
    ['top', Math.abs(p.y - r.y)],
    ['bottom', Math.abs(r.y + r.height - p.y)],
    ['left', Math.abs(p.x - r.x)],
    ['right', Math.abs(r.x + r.width - p.x)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}

/** 면 위에서 비율 t(0~1) 위치의 점 */
export function pointOnSide(r: Rect, side: Side, t: number): Vec {
  switch (side) {
    case 'top':
      return { x: r.x + r.width * t, y: r.y };
    case 'bottom':
      return { x: r.x + r.width * t, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height * t };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height * t };
  }
}

export const sideNormal = (side: Side): Vec =>
  side === 'top' ? { x: 0, y: -1 } : side === 'bottom' ? { x: 0, y: 1 } : side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };

/**
 * 선분 a→b 가 rect 테두리와 만나는 점 (a가 안, b가 밖이거나 그 반대일 때).
 * 교차가 없으면 null.
 */
export function segmentRectExit(r: Rect, inside: Vec, outside: Vec): Vec | null {
  // Liang–Barsky 방식: outside→inside 방향으로 들어오는 첫 교차점
  const dx = inside.x - outside.x;
  const dy = inside.y - outside.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (
    clip(-dx, outside.x - r.x) &&
    clip(dx, r.x + r.width - outside.x) &&
    clip(-dy, outside.y - r.y) &&
    clip(dy, r.y + r.height - outside.y)
  ) {
    return { x: outside.x + dx * t0, y: outside.y + dy * t0 };
  }
  return null;
}

export const expandRect = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  width: r.width + m * 2,
  height: r.height + m * 2,
});

export { clamp };
