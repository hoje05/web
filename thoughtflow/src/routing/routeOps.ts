/**
 * Route에 대한 Doc 연산 (순수 함수).
 */
import { sideForDirection, straightSides } from '../anchors/sideSelection';
import { reverseChord } from '../geometry/chord';
import { headingPoint } from '../geometry/curve';
import { nodeRect, pointOnSide } from '../geometry/rect';
import { sub } from '../geometry/vec';
import { setNodePosition, updateEdge } from '../model/docOps';
import type { Doc, RouteEdge, Side } from '../model/types';
import { edgeWorldPoints } from './edgePath';

/** 방향 반전: source/target과 anchor를 맞바꾸고 경로 점을 역순 변환. 모양은 그대로. */
export function reverseRoute(doc: Doc, id: string): Doc {
  const e = doc.edges[id];
  if (!e) return doc;
  return updateEdge(doc, id, {
    sourceNodeId: e.targetNodeId,
    targetNodeId: e.sourceNodeId,
    sourceAnchor: e.targetAnchor,
    targetAnchor: e.sourceAnchor,
    pathPoints: reverseChord(e.pathPoints),
  });
}

/** 현재 기하 상태에 가장 자연스러운 면 (hysteresis 포함) */
export function preferredSides(doc: Doc, edge: RouteEdge): [Side, Side] {
  const a = doc.nodes[edge.sourceNodeId];
  const b = doc.nodes[edge.targetNodeId];
  const current: [Side, Side] = [edge.sourceAnchor.side, edge.targetAnchor.side];
  if (!a || !b) return current;
  const ra = nodeRect(a);
  const rb = nodeRect(b);
  if (edge.pathMode === 'auto' || edge.pathMode === 'straight' || edge.pathPoints.length === 0) {
    return straightSides(ra, rb, current);
  }

  // 곡선: 경로의 시작/끝 접선 방향으로 판단 (Anchor는 면 중앙으로 근사)
  const pts = edgeWorldPoints(edge, pointOnSide(ra, current[0], 0.5), pointOnSide(rb, current[1], 0.5));
  const outS = sub(headingPoint(pts, false, 24), pts[0]);
  const outE = sub(headingPoint(pts, true, 24), pts[pts.length - 1]);
  return [sideForDirection(outS, current[0]), sideForDirection(outE, current[1])];
}

/** nodeIds에 연결된 Route들의 면을 다시 평가 */
export function refreshSides(doc: Doc, nodeIds: Set<string>): Doc {
  let next = doc;
  for (const e of Object.values(doc.edges)) {
    if (!nodeIds.has(e.sourceNodeId) && !nodeIds.has(e.targetNodeId)) continue;
    const [s, t] = preferredSides(next, e);
    if (s !== e.sourceAnchor.side || t !== e.targetAnchor.side) {
      next = updateEdge(next, e.id, { sourceAnchor: { side: s }, targetAnchor: { side: t } });
    }
  }
  return next;
}

/**
 * Box 이동. 연결된 Route는 처음 그린 모양을 고집하지 않고 자동 연결선(auto)으로 바뀌어,
 * 두 Box의 새 위치에 어울리는 면에 붙고 부드러운 곡선으로 다시 이어진다.
 * (드래그 중 면이 깜빡이지 않도록 이미 auto인 Route는 hysteresis로 면을 유지)
 */
export function moveNode(doc: Doc, id: string, x: number, y: number): Doc {
  let next = setNodePosition(doc, id, x, y);
  if (next === doc) return doc;
  for (const e of Object.values(next.edges)) {
    if (e.sourceNodeId !== id && e.targetNodeId !== id) continue;
    const a = next.nodes[e.sourceNodeId];
    const b = next.nodes[e.targetNodeId];
    if (!a || !b) continue;
    const fresh = e.pathMode !== 'auto';
    const [s, t] = straightSides(nodeRect(a), nodeRect(b), fresh ? null : [e.sourceAnchor.side, e.targetAnchor.side]);
    if (fresh || s !== e.sourceAnchor.side || t !== e.targetAnchor.side) {
      next = updateEdge(next, e.id, {
        pathMode: 'auto',
        pathPoints: [],
        sourceAnchor: { side: s },
        targetAnchor: { side: t },
      });
    }
  }
  return next;
}
