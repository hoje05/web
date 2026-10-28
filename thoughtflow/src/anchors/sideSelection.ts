/**
 * Route가 Box의 어느 면에 붙을지 결정한다.
 * 드래그 중 면이 계속 바뀌며 깜빡이지 않도록 hysteresis를 둔다:
 * 현재 면의 축(가로/세로)은 다른 축이 확실히(30% + 4px) 우세해질 때만 바꾼다.
 */
import { rectCenter, type Rect } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { Side } from '../model/types';

type Axis = 'H' | 'V';
const MARGIN = 1.3;
const MARGIN_ABS = 4;

export const axisOf = (side: Side): Axis => (side === 'left' || side === 'right' ? 'H' : 'V');

export const oppositeSide = (side: Side): Side =>
  side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top';

function pickAxis(sH: number, sV: number, current: Axis | null): Axis {
  if (current === 'H') return sV > sH * MARGIN + MARGIN_ABS ? 'V' : 'H';
  if (current === 'V') return sH > sV * MARGIN + MARGIN_ABS ? 'H' : 'V';
  return sH >= sV ? 'H' : 'V';
}

const sideFor = (axis: Axis, d: Vec): Side =>
  axis === 'H' ? (d.x >= 0 ? 'right' : 'left') : d.y >= 0 ? 'bottom' : 'top';

/**
 * 직선 Route: 두 Box 사이의 "간격"이 큰 축을 사용한다.
 * 옆으로 나란하면 좌/우 면, 위아래로 놓였으면 상/하 면.
 */
export function straightSides(a: Rect, b: Rect, current?: [Side, Side] | null): [Side, Side] {
  const ca = rectCenter(a);
  const cb = rectCenter(b);
  const d = { x: cb.x - ca.x, y: cb.y - ca.y };
  const gx = Math.max(0, Math.abs(d.x) - (a.width + b.width) / 2);
  const gy = Math.max(0, Math.abs(d.y) - (a.height + b.height) / 2);
  // 두 Box가 겹쳐 간격이 0일 때를 위해 중심 거리 성분을 약하게 더한다
  const sH = gx + Math.abs(d.x) * 0.05;
  const sV = gy + Math.abs(d.y) * 0.05;
  const axis = pickAxis(sH, sV, current ? axisOf(current[0]) : null);
  const s = sideFor(axis, d);
  return [s, oppositeSide(s)];
}

/** 곡선 Route의 한쪽 끝: 경로가 Box에서 나가는 방향(dir)에 맞는 면 */
export function sideForDirection(dir: Vec, current?: Side | null): Side {
  const axis = pickAxis(Math.abs(dir.x), Math.abs(dir.y), current ? axisOf(current) : null);
  return sideFor(axis, dir);
}

/** 새 Box를 만들 때: 면 중앙이 point에 오도록 배치한 Box의 좌상단 */
export function placeBoxBySide(point: Vec, side: Side, width: number, height: number): Vec {
  switch (side) {
    case 'left':
      return { x: point.x, y: point.y - height / 2 };
    case 'right':
      return { x: point.x - width, y: point.y - height / 2 };
    case 'top':
      return { x: point.x - width / 2, y: point.y };
    case 'bottom':
      return { x: point.x - width / 2, y: point.y - height };
  }
}
