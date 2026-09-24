import { dist, type Vec } from './vec';

/** cubic Bezier 한 구간: p0 → p3, 제어점 c1, c2 */
export interface Bezier {
  p0: Vec;
  c1: Vec;
  c2: Vec;
  p3: Vec;
}

/**
 * Centripetal Catmull-Rom(α=0.5) spline을 cubic Bezier 구간들로 변환한다.
 * 모든 점을 정확히 지나며, uniform Catmull-Rom과 달리 점 간격이 불균일해도
 * overshoot나 cusp(뾰족한 꼬임)가 생기지 않는다.
 * 양 끝은 반사점(2·P0 - P1)을 가상 이웃으로 사용해 끝 접선이 첫/마지막 구간 방향을 따르게 한다.
 */
export function catmullRomToBeziers(points: Vec[]): Bezier[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) {
    const [a, b] = points;
    return [{ p0: a, c1: lerpV(a, b, 1 / 3), c2: lerpV(a, b, 2 / 3), p3: b }];
  }
  const pts = [
    { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y },
    ...points,
    { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y },
  ];
  const out: Bezier[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    const d1 = Math.sqrt(dist(p0, p1));
    const d2 = Math.sqrt(dist(p1, p2));
    const d3 = Math.sqrt(dist(p2, p3));
    let c1: Vec;
    let c2: Vec;
    if (d1 < 1e-6 || d2 < 1e-6) {
      c1 = lerpV(p1, p2, 1 / 3);
    } else {
      const a = 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2;
      const b = 3 * d1 * (d1 + d2);
      c1 = {
        x: (d1 * d1 * p2.x - d2 * d2 * p0.x + a * p1.x) / b,
        y: (d1 * d1 * p2.y - d2 * d2 * p0.y + a * p1.y) / b,
      };
    }
    if (d3 < 1e-6 || d2 < 1e-6) {
      c2 = lerpV(p1, p2, 2 / 3);
    } else {
      const a = 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2;
      const b = 3 * d3 * (d3 + d2);
      c2 = {
        x: (d3 * d3 * p1.x - d2 * d2 * p3.x + a * p2.x) / b,
        y: (d3 * d3 * p1.y - d2 * d2 * p3.y + a * p2.y) / b,
      };
    }
    out.push({ p0: p1, c1, c2, p3: p2 });
  }
  return out;
}

const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

const f = (v: number) => Math.round(v * 100) / 100;

export function beziersToPathD(beziers: Bezier[]): string {
  if (beziers.length === 0) return '';
  let d = `M${f(beziers[0].p0.x)} ${f(beziers[0].p0.y)}`;
  for (const b of beziers) d += `C${f(b.c1.x)} ${f(b.c1.y)} ${f(b.c2.x)} ${f(b.c2.y)} ${f(b.p3.x)} ${f(b.p3.y)}`;
  return d;
}

export function polylineToPathD(points: Vec[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('');
}

export function bezierPoint(b: Bezier, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const c = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * b.p0.x + c * b.c1.x + d * b.c2.x + e * b.p3.x,
    y: a * b.p0.y + c * b.c1.y + d * b.c2.y + e * b.p3.y,
  };
}

/** Bezier 구간들을 polyline으로 샘플링 (hit test, 길이, 화살표 위치 계산용) */
export function sampleBeziers(beziers: Bezier[]): Vec[] {
  if (beziers.length === 0) return [];
  const out: Vec[] = [beziers[0].p0];
  for (const b of beziers) {
    const approxLen = dist(b.p0, b.c1) + dist(b.c1, b.c2) + dist(b.c2, b.p3);
    const steps = Math.max(2, Math.min(24, Math.ceil(approxLen / 8)));
    for (let i = 1; i <= steps; i++) out.push(bezierPoint(b, i / steps));
  }
  return out;
}

export function polylineLength(points: Vec[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

/** polyline 위에서 길이 target 지점의 위치와 진행 방향(라디안) */
export function pointAtLength(points: Vec[], target: number): { point: Vec; angle: number } {
  if (points.length === 1) return { point: points[0], angle: 0 };
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = dist(a, b);
    if (acc + seg >= target || i === points.length - 1) {
      const t = seg < 1e-9 ? 0 : Math.min(1, Math.max(0, (target - acc) / seg));
      return { point: lerpV(a, b, t), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    acc += seg;
  }
  return { point: points[points.length - 1], angle: 0 };
}

/** 한쪽 끝에서 경로를 따라 minDist 이상 떨어진 첫 점 (진행 방향 추정용) */
export function headingPoint(points: Vec[], fromEnd: boolean, minDist: number): Vec {
  const n = points.length;
  const origin = fromEnd ? points[n - 1] : points[0];
  for (let k = 1; k < n; k++) {
    const p = fromEnd ? points[n - 1 - k] : points[k];
    if (dist(p, origin) >= minDist) return p;
  }
  return fromEnd ? points[0] : points[n - 1];
}
