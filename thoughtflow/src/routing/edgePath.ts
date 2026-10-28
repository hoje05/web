import { fromChord } from '../geometry/chord';
import { dist, type Vec } from '../geometry/vec';
import type { RouteEdge } from '../model/types';

/** Route의 world 좌표 점들 [S, ...내부 점, E] — Chord 좌표를 실제 Anchor 기준으로 변환 */
export function edgeWorldPoints(edge: RouteEdge, s: Vec, e: Vec): Vec[] {
  if (edge.pathMode === 'straight' || edge.pathPoints.length === 0 || dist(s, e) < 1) return [s, e];
  return [s, ...fromChord(edge.pathPoints, s, e), e];
}
