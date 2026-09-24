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
import { edgeWorldPoints } from './routeGeometry';

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
  if (edge.pathMode === 'straight' || edge.pathPoints.length === 0) return straightSides(ra, rb, current);

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

/** Box 이동 + 연결된 Route의 Anchor 면 갱신. 곡선 형태는 Chord 좌표 덕분에 자동으로 유지된다. */
export function moveNode(doc: Doc, id: string, x: number, y: number): Doc {
  const moved = setNodePosition(doc, id, x, y);
  if (moved === doc) return doc;
  return refreshSides(moved, new Set([id]));
}
