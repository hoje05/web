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
  /** AI가 만든 Box면 그 AI 이름 (Claude, ChatGPT …). 사람이 만든 Box는 없음. */
  origin?: string;
  /** 붙인 태그 (Doc.tags의 id). 없으면 태그 없음. */
  tagIds?: string[];
  /** 첨부한 이미지·파일 (내용은 프로젝트의 자료 폴더에, 여기에는 위치와 정보만). 없으면 첨부 없음. */
  attachments?: Attachment[];
}

/**
 * Box에 첨부한 이미지·파일.
 * 실제 파일은 프로젝트 파일 옆의 자료 폴더(“프로젝트 이름.assets”)에 겹치지 않는 이름으로 복사해 둔다.
 * relativePath = "assets/<고유 이름>" → 자료 폴더 안의 그 파일. 첨부 하나는 한 Box만 쓴다 (다른 Box와 나눠 쓰지 않음).
 */
export interface Attachment {
  id: string;
  /** image = PNG/JPG/WebP (창 안에서 미리보기), file = 그 밖의 모든 파일 */
  type: 'image' | 'file';
  /** 원래 파일 이름 (보여 주는 이름) */
  name: string;
  relativePath: string;
  mimeType: string;
  /** 바이트 */
  size: number;
  width?: number;
  height?: number;
}

/**
 * 프로젝트에 저장해 두는 태그 (다시 쓰기·자동 완성용).
 * 이름은 처음 쓴 모양 그대로 보여 주고, 같은 태그인지는 normalizedName(앞뒤 공백 제거·소문자)으로 가린다.
 * 지운 태그는 active=false로만 바꾼다 → 이미 붙어 있는 Box에는 그대로 남고, 추천 목록에서만 빠진다.
 */
export interface Tag {
  id: string;
  name: string;
  normalizedName: string;
  active: boolean;
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

/**
 * auto     = 두 Box 위치에 맞춰 자동으로 그리는 부드러운 연결선 (Box를 옮기면 항상 이 모드)
 * smoothed = 그린 곡선을 자동 보정한 것 (Box를 옮기기 전까지 그린 모양 유지)
 * straight / freehand = 예전 버전 파일 호환용
 */
export type PathMode = 'auto' | 'smoothed' | 'straight' | 'freehand';

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
  /** 저장된 태그 (만든 순서). Undo 기록에 함께 들어가도록 Doc에 둔다. */
  tags: Record<string, Tag>;
}

/** screen = world * zoom + pan */
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export type Tool = 'select' | 'route';

export const EMPTY_DOC: Doc = { nodes: {}, edges: {}, tags: {} };

export const DEFAULT_BOX_WIDTH = 180;
export const DEFAULT_BOX_HEIGHT = 64;

export type { Vec };
