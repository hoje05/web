/**
 * Doc → 렌더링/hit test용 Route 기하 정보.
 * 모든 Route 기능(생성, 반전, 보정, Box 이동 추종, Anchor 분배)이 이 한 가지 파이프라인을 거친다.
 */
import { computeAnchors } from '../anchors/distribution';
import {
  beziersToPathD,
  catmullRomToBeziers,
  pointAtLength,
  polylineLength,
  polylineToPathD,
  sampleBeziers,
  type Bezier,
} from '../geometry/curve';
import { expandRect, nodeRect, rectContains, sideNormal, type Rect } from '../geometry/rect';
import { clamp, dist, type Vec } from '../geometry/vec';
import type { Doc, RouteEdge, Side } from '../model/types';
import { edgeWorldPoints } from './edgePath';

export interface RouteGeom {
  id: string;
  /** SVG path data */
  d: string;
  /** 샘플링된 경로 (hit test, 길이 계산) */
  polyline: Vec[];
  /** 화살표 위치(경로 길이의 중앙 — 다른 Box에 가려지면 가까운 보이는 지점)와 진행 방향(도) */
  arrow: { x: number; y: number; angle: number };
  length: number;
  start: Vec;
  end: Vec;
  bbox: Rect;
}

/**
 * 자동 연결선: 양 끝에서 연결 면에 수직으로 뻗어 나가 부드럽게 만나는 cubic Bezier.
 * Box가 어디로 움직이든 그 위치에 어울리는 모양이 된다.
 */
export function autoBezier(s: Vec, sSide: Side, e: Vec, eSide: Side): Bezier {
  let k = clamp(dist(s, e) * 0.42, 24, 180);
  const ns = sideNormal(sSide);
  const ne = sideNormal(eSide);
  // 마주 보는 면(→ ←, ↓ ↑)끼리면 곡선이 두 면 사이에서만 휘게: 위아래로 멀리 떨어져도 옆 Box 쪽으로 넘어가지 않는다
  const gap = (e.x - s.x) * ns.x + (e.y - s.y) * ns.y;
  if (ns.x === -ne.x && ns.y === -ne.y && gap > 0) k = Math.min(k, Math.max(gap / 2, 8));
  return { p0: s, c1: { x: s.x + ns.x * k, y: s.y + ns.y * k }, c2: { x: e.x + ne.x * k, y: e.y + ne.y * k }, p3: e };
}

export function buildRouteGeom(id: string, pts: Vec[], bezier?: Bezier): RouteGeom {
  let d: string;
  let polyline: Vec[];
  if (bezier) {
    d = beziersToPathD([bezier]);
    polyline = sampleBeziers([bezier]);
  } else if (pts.length <= 2) {
    d = polylineToPathD(pts);
    polyline = pts;
  } else {
    const bz = catmullRomToBeziers(pts);
    d = beziersToPathD(bz);
    polyline = sampleBeziers(bz);
  }
  const total = polylineLength(polyline);
  const mid = pointAtLength(polyline, total / 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polyline) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    id,
    d,
    polyline,
    arrow: { x: mid.point.x, y: mid.point.y, angle: (mid.angle * 180) / Math.PI },
    length: total,
    start: pts[0],
    end: pts[pts.length - 1],
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

/**
 * Route 하나의 기하 정보는 (Edge 데이터, 양 끝 Anchor)가 같으면 재사용한다.
 * → Box를 드래그하는 동안 움직이지 않은 Route는 같은 객체를 유지해 다시 렌더링되지 않는다.
 */
const edgeCache = new Map<string, { edge: RouteEdge; key: string; base: RouteGeom; placed: RouteGeom }>();

/** 화살표 후보 위치 (경로 길이 비율): 중앙부터 바깥쪽으로 */
const ARROW_CANDIDATES = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];

/**
 * Route가 다른 Box 밑을 지나가면 중앙의 화살표가 가려져 방향을 알 수 없다.
 * → 중앙에서 가장 가까운, 어떤 Box에도 가려지지 않는 지점에 화살표를 둔다.
 */
function placeArrow(g: RouteGeom, obstacles: Rect[]): RouteGeom['arrow'] {
  if (obstacles.length === 0) return g.arrow;
  for (const f of ARROW_CANDIDATES) {
    const { point, angle } = pointAtLength(g.polyline, g.length * f);
    if (!obstacles.some((r) => rectContains(r, point))) {
      return f === 0.5 ? g.arrow : { x: point.x, y: point.y, angle: (angle * 180) / Math.PI };
    }
  }
  return g.arrow;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

export function computeRouteGeometry(doc: Doc): Map<string, RouteGeom> {
  const anchors = computeAnchors(doc);
  const rects = Object.values(doc.nodes).map((n) => expandRect(nodeRect(n), 6));
  const out = new Map<string, RouteGeom>();
  for (const edge of Object.values(doc.edges)) {
    const a = anchors.get(edge.id);
    if (!a) continue;
    const key = `${a.source.x},${a.source.y},${a.target.x},${a.target.y}`;
    let entry = edgeCache.get(edge.id);
    if (!entry || entry.edge !== edge || entry.key !== key) {
      const base =
        edge.pathMode === 'auto'
          ? buildRouteGeom(edge.id, [a.source, a.target], autoBezier(a.source, edge.sourceAnchor.side, a.target, edge.targetAnchor.side))
          : buildRouteGeom(edge.id, edgeWorldPoints(edge, a.source, a.target));
      entry = { edge, key, base, placed: base };
      edgeCache.set(edge.id, entry);
    }
    const base = entry.base;
    const arrow = placeArrow(base, rects.filter((r) => overlaps(r, base.bbox)));
    const prev = entry.placed.arrow;
    if (arrow.x !== prev.x || arrow.y !== prev.y || arrow.angle !== prev.angle) {
      entry.placed = arrow === base.arrow ? base : { ...base, arrow };
    }
    out.set(edge.id, entry.placed);
  }
  // 삭제된 Route의 캐시 정리
  if (edgeCache.size > out.size * 2 + 64) {
    for (const id of edgeCache.keys()) if (!doc.edges[id]) edgeCache.delete(id);
  }
  return out;
}

/** 같은 Doc 객체에 대해서는 한 번만 계산 (렌더링과 hit test가 공유) */
const cache = new WeakMap<Doc, Map<string, RouteGeom>>();
export function getRouteGeometry(doc: Doc): Map<string, RouteGeom> {
  let g = cache.get(doc);
  if (!g) {
    g = computeRouteGeometry(doc);
    cache.set(doc, g);
  }
  return g;
}
