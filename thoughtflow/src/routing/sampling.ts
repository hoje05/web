import { dist, type Vec } from '../geometry/vec';

/**
 * 마우스 좌표를 모두 저장하지 않고, 직전 저장점과 minDist 이상 떨어진 점만 저장한다.
 * (점 밀도를 고르게 해 성능과 경로 품질을 함께 확보)
 */
export function appendSample(points: Vec[], p: Vec, minDist: number): boolean {
  const last = points[points.length - 1];
  if (last && dist(last, p) < minDist) return false;
  points.push(p);
  return true;
}
