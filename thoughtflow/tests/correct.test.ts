import { describe, expect, it } from 'vitest';
import { distToSegment, type Vec } from '../src/geometry/vec';
import { cleanDrawnPath, correctPath } from '../src/routing/correct';
import { rdp } from '../src/routing/simplify';
import { gaussianSmooth, resample } from '../src/routing/smooth';

/** 재현 가능한 의사 난수 */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function sample(f: (t: number) => Vec, n: number, jitter: number, seed = 1): Vec[] {
  const r = rng(seed);
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = f(i / n);
    const edge = i === 0 || i === n;
    return edge ? p : { x: p.x + (r() - 0.5) * 2 * jitter, y: p.y + (r() - 0.5) * 2 * jitter };
  });
}

/** 점 p에서 기준 곡선(촘촘한 polyline)까지 거리 */
function distToCurve(p: Vec, ref: Vec[]) {
  let m = Infinity;
  for (let i = 1; i < ref.length; i++) m = Math.min(m, distToSegment(p, ref[i - 1], ref[i]));
  return m;
}

describe('rdp', () => {
  it('removes collinear points', () => {
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x: x * 10, y: 0 }));
    expect(rdp(pts, 0.5)).toHaveLength(2);
  });
});

describe('resample + smoothing', () => {
  it('resamples evenly and keeps endpoints', () => {
    const out = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
    expect(out.length).toBe(11);
  });

  it('keeps a straight line straight (odd reflection padding)', () => {
    const line = Array.from({ length: 30 }, (_, i) => ({ x: i * 5, y: i * 2 }));
    const sm = gaussianSmooth(line, 4);
    sm.forEach((p, i) => {
      expect(p.x).toBeCloseTo(line[i].x, 6);
      expect(p.y).toBeCloseTo(line[i].y, 6);
    });
  });
});

describe('correctPath (보정)', () => {
  it('turns a shaky straight drag into a straight route', () => {
    const shaky = sample((t) => ({ x: t * 400, y: 0 }), 120, 4);
    expect(correctPath(shaky).straight).toBe(true);
  });

  it('removes zigzag but keeps a big intentional curve', () => {
    // 큰 아치(높이 120) + 짧은 파장의 지그재그(±8) + 흔들림
    const ideal = (t: number) => ({ x: t * 400, y: -Math.sin(Math.PI * t) * 120 });
    const raw = sample((t) => {
      const p = ideal(t);
      return { x: p.x, y: p.y + Math.sin(t * 40 * Math.PI) * 8 };
    }, 200, 2);
    const res = correctPath(raw);
    expect(res.straight).toBe(false);
    expect(res.points.length).toBeLessThanOrEqual(12);
    expect(res.points[0]).toEqual(raw[0]);
    expect(res.points[res.points.length - 1]).toEqual(raw[raw.length - 1]);
    const ref = Array.from({ length: 401 }, (_, i) => ideal(i / 400));
    // 결과 점들이 의도한 곡선 근처에 있음 (지그재그 진폭 8보다 확실히 작음)
    for (const p of res.points) expect(distToCurve(p, ref)).toBeLessThan(6);
    // 곡선의 높이(의도)는 유지
    const top = Math.min(...res.points.map((p) => p.y));
    expect(top).toBeLessThan(-100);
  });

  it('keeps an intentional detour', () => {
    // ㄷ자 우회 경로: 위로 150 올라갔다가 옆으로 가서 다시 내려옴
    const raw: Vec[] = [];
    const push = (a: Vec, b: Vec, n: number) => {
      for (let i = 0; i < n; i++) raw.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
    };
    push({ x: 0, y: 0 }, { x: 0, y: -150 }, 40);
    push({ x: 0, y: -150 }, { x: 300, y: -150 }, 80);
    push({ x: 300, y: -150 }, { x: 300, y: 0 }, 40);
    raw.push({ x: 300, y: 0 });
    const res = correctPath(raw);
    expect(res.straight).toBe(false);
    const top = Math.min(...res.points.map((p) => p.y));
    expect(top).toBeLessThan(-120);
  });

  it('follows the intended curve for short and long routes alike', () => {
    for (const k of [0.5, 1, 2, 4]) {
      const ideal = (t: number) => ({ x: t * 300 * k, y: -Math.sin(Math.PI * t) * 90 * k });
      const raw = sample(ideal, 150, 3, 7);
      const res = correctPath(raw);
      expect(res.straight).toBe(false);
      const ref = Array.from({ length: 601 }, (_, i) => ideal(i / 600));
      for (const p of res.points) expect(distToCurve(p, ref)).toBeLessThan(Math.max(4, 90 * k * 0.06));
    }
  });
});

describe('cleanDrawnPath (그린 직후 자동 정리)', () => {
  it('snaps an almost straight drag to straight', () => {
    const raw = sample((t) => ({ x: t * 300, y: Math.sin(Math.PI * t) * 10 }), 60, 1.5);
    expect(cleanDrawnPath(raw, 1).straight).toBe(true);
  });

  it('keeps a drawn curve as freehand', () => {
    const raw = sample((t) => ({ x: t * 300, y: Math.sin(Math.PI * t) * 80 }), 60, 1.5);
    const res = cleanDrawnPath(raw, 1);
    expect(res.straight).toBe(false);
    expect(res.points.length).toBeGreaterThan(10);
  });
});
