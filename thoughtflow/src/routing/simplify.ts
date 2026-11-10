import { distToSegment, type Vec } from '../geometry/vec';

/**
 * Ramer–Douglas–Peucker 경로 단순화.
 * 양 끝을 잇는 선분에서 epsilon 이상 벗어난 가장 먼 점만 남기는 과정을 재귀적으로 반복한다.
 * (깊은 경로에서도 안전하도록 stack으로 구현)
 */
export function rdp(points: Vec[], epsilon: number): Vec[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** 양 끝을 잇는 직선(chord)에서 가장 멀리 벗어난 거리 */
export function maxChordDeviation(points: Vec[]): number {
  const a = points[0];
  const b = points[points.length - 1];
  let m = 0;
  for (const p of points) m = Math.max(m, distToSegment(p, a, b));
  return m;
}
