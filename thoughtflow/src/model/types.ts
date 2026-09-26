import type { Vec } from '../geometry/vec';

/** Box의 네 면. Route는 한 면에 연결되고, 면 위의 정확한 위치는 Anchor Distribution이 계산한다. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** 사용자 용어: Box */
export interface BoxNode {
  id: string;
  /** world 좌표 (좌상단) */
  x: number;
  y: number;
  /** DOM에서 측정한 실제 크기. Anchor 계산에 사용한다. */
  width: number;
  height: number;
  /** Box에 보이는 짧은 내용 (제목) */
  text: string;
  /** 오른쪽 창에서 쓰는 긴 생각 메모 */
  note: string;
}

export interface Anchor {
  side: Side;
}

/**
 * Chord 좌표 [u, v].
 * 시작 Anchor S → 끝 Anchor E 선분(d = E - S)에 대해 world = S + u·d + v·perp(d).
 * Box가 움직여도 곡선의 상대적인 형태(닮음)가 유지된다.
 */
export type ChordPoint = [number, number];

/** straight = 직선, freehand = 손으로 그린 그대로, smoothed = 보정됨 */
export type PathMode = 'straight' | 'freehand' | 'smoothed';

/**
 * 사용자 용어: Route.
 * 방향은 source → target 순서 자체로 표현한다 (반전 = source/target 교환).
 */
export interface RouteEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceAnchor: Anchor;
  targetAnchor: Anchor;
  /** 곡선 내부 점 (시작/끝점 제외), source → target 순서 */
  pathPoints: ChordPoint[];
  pathMode: PathMode;
}

export interface Doc {
  nodes: Record<string, BoxNode>;
  edges: Record<string, RouteEdge>;
}

/** screen = world * zoom + pan */
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export type Tool = 'select' | 'route';

export const EMPTY_DOC: Doc = { nodes: {}, edges: {} };

export const DEFAULT_BOX_WIDTH = 180;
export const DEFAULT_BOX_HEIGHT = 64;

export type { Vec };
