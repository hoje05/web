/**
 * Anchor 위치 계산.
 * 각 Route 끝점은 면(side)만 저장하고, 면 위의 실제 위치는 여기서 계산한다.
 */
import { nodeRect, pointOnSide } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { Doc } from '../model/types';

export interface EdgeAnchors {
  source: Vec;
  target: Vec;
}

export function computeAnchors(doc: Doc): Map<string, EdgeAnchors> {
  const out = new Map<string, EdgeAnchors>();
  for (const e of Object.values(doc.edges)) {
    const a = doc.nodes[e.sourceNodeId];
    const b = doc.nodes[e.targetNodeId];
    if (!a || !b) continue;
    out.set(e.id, {
      source: pointOnSide(nodeRect(a), e.sourceAnchor.side, 0.5),
      target: pointOnSide(nodeRect(b), e.targetAnchor.side, 0.5),
    });
  }
  return out;
}
