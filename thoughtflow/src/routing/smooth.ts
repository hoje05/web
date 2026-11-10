import { dist, type Vec } from '../geometry/vec';

/** 호 길이 기준 등간격 재샘플링 (양 끝점 포함) */
export function resample(points: Vec[], step: number): Vec[] {
  if (points.length < 2 || step <= 0) return points.slice();
  const out: Vec[] = [points[0]];
  let carry = 0; // 마지막 출력점 이후 지나온 거리
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = dist(a, b);
    if (seg < 1e-9) continue;
    let t = step - carry;
    while (t <= seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg });
      t += step;
    }
    carry = seg - (t - step);
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) < step * 0.35 && out.length > 1) out[out.length - 1] = last;
  else out.push(last);
  return out;
}

/**
 * Gaussian smoothing (저역 통과 필터). sigma는 "점 개수" 단위.
 * 양 끝은 점대칭 반사(2·P0 − Pk)로 padding 해서 끝 근처도 치우침 없이 평활화하고,
 * 마지막에 시작점/끝점을 원래 위치에 고정한다.
 * → 파장이 짧은 흔들림·지그재그는 사라지고 파장이 긴 큰 곡선은 거의 그대로 남는다.
 */
export function gaussianSmooth(points: Vec[], sigma: number): Vec[] {
  const n = points.length;
  if (n < 3 || sigma < 0.5) return points.slice();
  const R = Math.ceil(sigma * 3);
  const w: number[] = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const first = points[0];
  const last = points[n - 1];
  const at = (i: number): Vec => {
    if (i < 0) {
      const p = points[Math.min(n - 1, -i)];
      return { x: 2 * first.x - p.x, y: 2 * first.y - p.y };
    }
    if (i >= n) {
      const p = points[Math.max(0, 2 * (n - 1) - i)];
      return { x: 2 * last.x - p.x, y: 2 * last.y - p.y };
    }
    return points[i];
  };
  const out: Vec[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = -R; k <= R; k++) {
      const p = at(i + k);
      const wk = w[k + R];
      sx += p.x * wk;
      sy += p.y * wk;
      sw += wk;
    }
    out[i] = { x: sx / sw, y: sy / sw };
  }
  out[0] = first;
  out[n - 1] = last;
  return out;
}
