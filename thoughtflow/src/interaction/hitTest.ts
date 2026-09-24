import { insideBorderDistance, nodeRect, outsideDistance, rectContains } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { Doc } from '../model/types';

/** 화면 px 기준 hit 영역 (world 거리 = px / zoom) */
export const HIT = {
  /** Box 안쪽 테두리 band — 여기서 드래그하면 Route */
  borderInner: 9,
  /** Box 바깥 테두리 band */
  borderOuter: 7,
} as const;

export type Hit =
  | { kind: 'node-body'; nodeId: string }
  | { kind: 'node-border'; nodeId: string }
  | { kind: 'empty' };

/** 위에 그려진 Box부터(나중에 추가된 것부터) 검사 */
function nodesTopFirst(doc: Doc) {
  return Object.values(doc.nodes).reverse();
}

export function hitTest(doc: Doc, p: Vec, zoom: number): Hit {
  const nodes = nodesTopFirst(doc);

  // 1) Box 내부: 테두리 band면 border, 아니면 body
  for (const n of nodes) {
    const r = nodeRect(n);
    if (rectContains(r, p)) {
      // 작은 Box(또는 많이 축소한 상태)에서도 body 영역이 남도록 band를 Box 크기의 25%로 제한
      const band = Math.min(HIT.borderInner / zoom, Math.min(r.width, r.height) * 0.25);
      return insideBorderDistance(r, p) <= band ? { kind: 'node-border', nodeId: n.id } : { kind: 'node-body', nodeId: n.id };
    }
  }

  // 2) Box 바깥 band
  const outer = HIT.borderOuter / zoom;
  for (const n of nodes) {
    if (outsideDistance(nodeRect(n), p) <= outer) return { kind: 'node-border', nodeId: n.id };
  }

  return { kind: 'empty' };
}

/** Route를 놓을 대상 Box (조금 넉넉한 범위) */
export function nodeAt(doc: Doc, p: Vec, zoom: number, exclude?: string): string | null {
  const margin = 12 / zoom;
  for (const n of nodesTopFirst(doc)) {
    if (n.id === exclude) continue;
    if (outsideDistance(nodeRect(n), p) <= margin) return n.id;
  }
  return null;
}
