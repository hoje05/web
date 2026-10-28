import { describe, expect, it } from 'vitest';
import { fromChord, reverseChord, toChord } from '../src/geometry/chord';
import { catmullRomToBeziers, pointAtLength, polylineLength, sampleBeziers } from '../src/geometry/curve';
import { segmentRectExit } from '../src/geometry/rect';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

describe('chord frame', () => {
  const s = { x: 10, y: 20 };
  const e = { x: 110, y: 70 };
  const pts = [
    { x: 30, y: 0 },
    { x: 60, y: 90 },
    { x: 100, y: 40 },
  ];

  it('round-trips world points', () => {
    const back = fromChord(toChord(pts, s, e), s, e);
    back.forEach((p, i) => expect(close(p, pts[i])).toBe(true));
  });

  it('preserves shape under similarity (moving endpoints scales/rotates the curve)', () => {
    const cps = toChord(pts, s, e);
    // S, E를 2배 확대 + 평행이동한 위치로 옮기면 곡선 점도 똑같이 변환되어야 한다
    const s2 = { x: s.x * 2 + 5, y: s.y * 2 - 3 };
    const e2 = { x: e.x * 2 + 5, y: e.y * 2 - 3 };
    const moved = fromChord(cps, s2, e2);
    moved.forEach((p, i) => expect(close(p, { x: pts[i].x * 2 + 5, y: pts[i].y * 2 - 3 })).toBe(true));
  });

  it('reverse keeps the same world shape', () => {
    const cps = toChord(pts, s, e);
    const rev = fromChord(reverseChord(cps), e, s);
    rev.reverse().forEach((p, i) => expect(close(p, pts[i])).toBe(true));
  });
});

describe('catmull-rom', () => {
  it('passes through every point', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 30 },
      { x: 120, y: -10 },
      { x: 200, y: 40 },
    ];
    const bz = catmullRomToBeziers(pts);
    expect(bz).toHaveLength(3);
    bz.forEach((b, i) => {
      expect(close(b.p0, pts[i])).toBe(true);
      expect(close(b.p3, pts[i + 1])).toBe(true);
    });
  });

  it('samples a straight line with exact length and midpoint', () => {
    const bz = catmullRomToBeziers([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const poly = sampleBeziers(bz);
    expect(polylineLength(poly)).toBeCloseTo(100, 5);
    const mid = pointAtLength(poly, 50);
    expect(mid.point.x).toBeCloseTo(50, 5);
    expect(mid.angle).toBeCloseTo(0, 5);
  });
});

describe('rect clipping', () => {
  it('finds boundary crossing', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    const p = segmentRectExit(r, { x: 50, y: 25 }, { x: 150, y: 25 });
    expect(p && close(p, { x: 100, y: 25 })).toBe(true);
  });
});
