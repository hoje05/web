/**
 * Chord 좌표계.
 * 곡선 내부 점을 시작점 S → 끝점 E 선분(chord)에 대한 상대 좌표 (u, v)로 저장한다.
 *   d = E - S,  world = S + u·d + v·perp(d)
 * S, E가 바뀌면 곡선 전체가 닮음 변환(이동·회전·균등 스케일)되어 형태가 유지된다.
 */
import type { ChordPoint } from '../model/types';
import { perp, sub, type Vec } from './vec';

export function toChord(points: Vec[], s: Vec, e: Vec): ChordPoint[] {
  const d = sub(e, s);
  const l2 = d.x * d.x + d.y * d.y;
  if (l2 < 1e-9) return [];
  const pd = perp(d);
  return points.map((p) => {
    const r = sub(p, s);
    return [(r.x * d.x + r.y * d.y) / l2, (r.x * pd.x + r.y * pd.y) / l2];
  });
}

export function fromChord(cps: ChordPoint[], s: Vec, e: Vec): Vec[] {
  const d = sub(e, s);
  const pd = perp(d);
  return cps.map(([u, v]) => ({ x: s.x + u * d.x + v * pd.x, y: s.y + u * d.y + v * pd.y }));
}

/** 방향 반전: 점 순서를 뒤집고 반대 chord 기준 좌표로 변환 → 화면상의 모양은 그대로 */
export function reverseChord(cps: ChordPoint[]): ChordPoint[] {
  return cps
    .slice()
    .reverse()
    .map(([u, v]) => [1 - u, -v] as ChordPoint);
}
