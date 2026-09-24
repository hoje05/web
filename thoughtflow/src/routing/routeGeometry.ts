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
} from '../geometry/curve';
import type { Rect } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { Doc } from '../model/types';
import { edgeWorldPoints } from './edgePath';

export interface RouteGeom {
  id: string;
  /** SVG path data */
  d: string;
  /** 샘플링된 경로 (hit test, 길이 계산) */
  polyline: Vec[];
  /** 화살표 위치(경로 길이의 중앙)와 진행 방향(도) */
  arrow: { x: number; y: number; angle: number };
  start: Vec;
  end: Vec;
  bbox: Rect;
}

export function buildRouteGeom(id: string, pts: Vec[]): RouteGeom {
  let d: string;
  let polyline: Vec[];
  if (pts.length <= 2) {
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
    start: pts[0],
    end: pts[pts.length - 1],
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

export function computeRouteGeometry(doc: Doc): Map<string, RouteGeom> {
  const anchors = computeAnchors(doc);
  const out = new Map<string, RouteGeom>();
  for (const edge of Object.values(doc.edges)) {
    const a = anchors.get(edge.id);
    if (!a) continue;
    out.set(edge.id, buildRouteGeom(edge.id, edgeWorldPoints(edge, a.source, a.target)));
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
