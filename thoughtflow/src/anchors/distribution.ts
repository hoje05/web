/**
 * Anchor Distribution.
 *
 * 각 Route 끝점은 면(side)만 저장하고, 면 위의 실제 위치는 여기서 계산한다.
 *  1. (Box, 면)별로 끝점을 모은다.
 *  2. 각 끝점의 "진행 방향 점"(곡선이면 경로를 따라 24px 앞의 점, 직선이면 반대쪽 Anchor)을 구한다.
 *  3. 면의 축 방향 좌표(top/bottom → x, left/right → y)로 정렬 → Route끼리 교차하지 않는 순서.
 *     처음 나가는 방향이 거의 같으면(약 15° 이내) 반대쪽 끝이 있는 곳으로 정한다 (작은 차이로 순서가 흔들리지 않게).
 *  4. n개를 면 위 (i+1)/(n+1) 위치에 균등 배치: 1개 → 중앙, 2개 → 1/3·2/3, 3개 → 1/4·2/4·3/4
 */
import { headingPoint } from '../geometry/curve';
import { nodeRect, pointOnSide } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { Doc, RouteEdge, Side } from '../model/types';
import { edgeWorldPoints } from '../routing/edgePath';

export interface EdgeAnchors {
  source: Vec;
  target: Vec;
}

interface Endpoint {
  edge: RouteEdge;
  end: 'source' | 'target';
  key: number;
  /** 반대쪽 끝의 위치 (key가 거의 같을 때) */
  far: number;
}

const HEADING_DISTANCE = 24;
/** 진행 방향 점이 이만큼(약 15°) 안쪽으로 가까우면 "같은 방향"으로 보고 반대쪽 끝 위치로 순서를 정한다 */
const SAME_DIRECTION = 6;

/** 면 위의 비율 t: n개일 때 i번째 */
export const distributionT = (i: number, n: number) => (i + 1) / (n + 1);

export function computeAnchors(doc: Doc): Map<string, EdgeAnchors> {
  const edges = Object.values(doc.edges).filter((e) => doc.nodes[e.sourceNodeId] && doc.nodes[e.targetNodeId]);

  // 1) 면 중앙을 임시 Anchor로 사용해 각 끝점의 진행 방향 점을 구한다
  const groups = new Map<string, Endpoint[]>();
  const add = (nodeId: string, side: Side, ep: Endpoint) => {
    const k = `${nodeId}|${side}`;
    const list = groups.get(k);
    if (list) list.push(ep);
    else groups.set(k, [ep]);
  };
  for (const e of edges) {
    const s0 = pointOnSide(nodeRect(doc.nodes[e.sourceNodeId]), e.sourceAnchor.side, 0.5);
    const t0 = pointOnSide(nodeRect(doc.nodes[e.targetNodeId]), e.targetAnchor.side, 0.5);
    const pts = edgeWorldPoints(e, s0, t0);
    const hs = headingPoint(pts, false, HEADING_DISTANCE);
    const ht = headingPoint(pts, true, HEADING_DISTANCE);
    add(e.sourceNodeId, e.sourceAnchor.side, { edge: e, end: 'source', key: alongAxis(e.sourceAnchor.side, hs), far: alongAxis(e.sourceAnchor.side, t0) });
    add(e.targetNodeId, e.targetAnchor.side, { edge: e, end: 'target', key: alongAxis(e.targetAnchor.side, ht), far: alongAxis(e.targetAnchor.side, s0) });
  }

  // 2) 면마다 정렬 후 균등 배치
  const partial = new Map<string, Partial<EdgeAnchors>>();
  for (const [k, list] of groups) {
    const [nodeId, side] = k.split('|') as [string, Side];
    const rect = nodeRect(doc.nodes[nodeId]);
    list.sort((a, b) => (Math.abs(a.key - b.key) > SAME_DIRECTION ? a.key - b.key : a.far - b.far) || (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0));
    list.forEach((ep, i) => {
      const p = pointOnSide(rect, side, distributionT(i, list.length));
      const cur = partial.get(ep.edge.id) ?? {};
      cur[ep.end] = p;
      partial.set(ep.edge.id, cur);
    });
  }

  const out = new Map<string, EdgeAnchors>();
  for (const [id, a] of partial) if (a.source && a.target) out.set(id, a as EdgeAnchors);
  return out;
}

const alongAxis = (side: Side, p: Vec) => (side === 'top' || side === 'bottom' ? p.x : p.y);
