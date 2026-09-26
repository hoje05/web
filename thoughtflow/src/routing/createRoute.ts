/**
 * 사용자가 그린 경로(draft) → Doc 변경 (Route 추가 + 필요하면 양 끝에 새 Box).
 *
 *  - 기존 Box에서 시작/끝나면 Box 내부 구간을 잘라내고, 테두리를 통과한 면에 연결한다.
 *  - 빈 곳에서 시작/끝나면 새 Box를 만든다. 새 Box는 "진행 방향을 마주 보는 면의 중앙"이
 *    정확히 그 지점에 오도록 배치되어, Route 끝이 사용자가 놓은 위치에서 어긋나지 않는다.
 */
import { oppositeSide, placeBoxBySide, sideForDirection, straightSides } from '../anchors/sideSelection';
import { toChord } from '../geometry/chord';
import { headingPoint, polylineLength } from '../geometry/curve';
import { nearestSide, nodeRect, rectContains, segmentRectExit, type Rect } from '../geometry/rect';
import { sub, type Vec } from '../geometry/vec';
import { addEdge, addNode } from '../model/docOps';
import { newId } from '../model/ids';
import { DEFAULT_BOX_HEIGHT, DEFAULT_BOX_WIDTH, type Doc, type RouteEdge, type Side } from '../model/types';
import { cleanDrawnPath } from './correct';

export interface RouteDraft {
  /** 기존 Box에서 시작했으면 그 id, 빈 곳에서 시작했으면 null */
  sourceNodeId: string | null;
  /** 샘플링된 world 좌표 (points[0] = 누른 위치, 마지막 = 놓은 위치) */
  points: Vec[];
}

export interface CreatedRoute {
  doc: Doc;
  edgeId: string;
  createdNodeIds: string[];
  /** 생성 직후 바로 텍스트를 입력할 Box */
  editNodeId: string | null;
}

/** 이보다 짧게(화면 px) 끌면 Route를 만들지 않는다 (실수로 인한 클릭 방지) */
export const MIN_ROUTE_SCREEN_LENGTH = 18;

/** rect 안에서 시작하는 앞부분을 잘라내고 테두리 교차점을 새 시작점으로 */
export function trimStartOutside(points: Vec[], r: Rect): Vec[] | null {
  const i = points.findIndex((p) => !rectContains(r, p));
  if (i < 0) return null;
  if (i === 0) return points;
  const cross = segmentRectExit(r, points[i - 1], points[i]) ?? points[i];
  return [cross, ...points.slice(i)];
}

export function trimEndOutside(points: Vec[], r: Rect): Vec[] | null {
  const t = trimStartOutside(points.slice().reverse(), r);
  return t ? t.reverse() : null;
}

export function createRoute(doc: Doc, draft: RouteDraft, targetNodeId: string | null, zoom: number): CreatedRoute | null {
  const { sourceNodeId } = draft;
  if (draft.points.length < 2) return null;
  if (targetNodeId && targetNodeId === sourceNodeId) return null;

  const source = sourceNodeId ? doc.nodes[sourceNodeId] : null;
  const target = targetNodeId ? doc.nodes[targetNodeId] : null;

  // 1) Box 내부 구간 잘라내기
  let pts: Vec[] | null = draft.points;
  if (source) pts = trimStartOutside(pts, nodeRect(source));
  if (pts && target) pts = trimEndOutside(pts, nodeRect(target));
  if (!pts || pts.length < 2) return null;
  if (polylineLength(pts) * zoom < MIN_ROUTE_SCREEN_LENGTH) return null;

  // 2) 자동 정리: 중복점 제거, 거의 곧은 선은 완전한 직선으로
  const cleaned = cleanDrawnPath(pts, zoom);
  pts = cleaned.points;
  const straight = cleaned.straight;

  const startPt = pts[0];
  const endPt = pts[pts.length - 1];
  // 새 Box를 어느 방향으로 펼칠지: 직선은 전체 방향, 곡선은 양 끝의 진행 방향
  const headOut = straight ? sub(endPt, startPt) : sub(headingPoint(pts, false, 20), startPt);
  const headIn = straight ? sub(endPt, startPt) : sub(endPt, headingPoint(pts, true, 20));

  let next = doc;
  const created: string[] = [];

  // 3) 시작 쪽 Box
  let srcId: string;
  let srcSide: Side;
  if (source) {
    srcId = source.id;
    srcSide = nearestSide(nodeRect(source), startPt);
  } else {
    srcId = newId('n');
    srcSide = sideForDirection(headOut);
    const pos = placeBoxBySide(startPt, srcSide, DEFAULT_BOX_WIDTH, DEFAULT_BOX_HEIGHT);
    next = addNode(next, { id: srcId, ...roundPos(pos), width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT, text: '', note: '' });
    created.push(srcId);
  }

  // 4) 끝 쪽 Box
  let tgtId: string;
  let tgtSide: Side;
  if (target) {
    tgtId = target.id;
    tgtSide = nearestSide(nodeRect(target), endPt);
  } else {
    tgtId = newId('n');
    tgtSide = oppositeSide(sideForDirection(headIn));
    const pos = placeBoxBySide(endPt, tgtSide, DEFAULT_BOX_WIDTH, DEFAULT_BOX_HEIGHT);
    next = addNode(next, { id: tgtId, ...roundPos(pos), width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT, text: '', note: '' });
    created.push(tgtId);
  }

  // 5) 직선: 기존 Box 쪽 면은 두 Box의 상대 위치로 다듬는다 (그은 면을 우선하는 hysteresis).
  //    곡선: 경로가 실제로 통과한 면 = 사용자의 의도이므로 그대로 둔다.
  if (straight) {
    const [s2, t2] = straightSides(nodeRect(next.nodes[srcId]), nodeRect(next.nodes[tgtId]), [srcSide, tgtSide]);
    if (source) srcSide = s2;
    if (target) tgtSide = t2;
  }

  const edge: RouteEdge = {
    id: newId('e'),
    sourceNodeId: srcId,
    targetNodeId: tgtId,
    sourceAnchor: { side: srcSide },
    targetAnchor: { side: tgtSide },
    // 곡선 내부 점은 "그린 경로의 양 끝"을 기준으로 정규화 → 실제 Anchor에 닮음 변환되어 그대로 표시된다
    pathPoints: straight ? [] : toChord(pts.slice(1, -1), startPt, endPt),
    pathMode: straight ? 'straight' : 'freehand',
  };
  next = addEdge(next, edge);

  return {
    doc: next,
    edgeId: edge.id,
    createdNodeIds: created,
    // 흐름상 먼저인 Box부터 입력 (양쪽 다 새 Box면 source → Tab으로 target)
    editNodeId: !source ? srcId : !target ? tgtId : null,
  };
}

const roundPos = (p: Vec) => ({ x: Math.round(p.x), y: Math.round(p.y) });
