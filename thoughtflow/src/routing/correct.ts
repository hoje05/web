/**
 * Route 보정 알고리즘.
 *
 *  1. 등간격 재샘플링      — 마우스 속도에 따른 점 밀도 차이 제거
 *  2. Gaussian smoothing   — 작은 흔들림·지그재그 제거 (끝점 고정)
 *  3. RDP 단순화           — 큰 곡선의 핵심 점만 남김
 *  4. 직선 판정            — 거의 곧으면 완전한 직선으로
 *  (렌더링은 centripetal Catmull-Rom → Bezier 로 부드럽게)
 *
 * 파라미터는 경로 길이에 비례(상·하한 포함)하므로 줌 배율과 무관하게 같은 결과가 나온다.
 */
import { clamp, dist, type Vec } from '../geometry/vec';
import { polylineLength } from '../geometry/curve';
import { maxChordDeviation, rdp } from './simplify';
import { gaussianSmooth, resample } from './smooth';

export interface CorrectedPath {
  straight: boolean;
  /** 시작/끝점을 포함한 world 좌표 점들 */
  points: Vec[];
}

export function correctPath(points: Vec[]): CorrectedPath {
  const a = points[0];
  const b = points[points.length - 1];
  const L = polylineLength(points);
  const chord = dist(a, b);
  if (points.length <= 2 || L < 1 || chord < 1) return { straight: true, points: [a, b] };

  const step = clamp(L / 150, 2, 6);
  const even = resample(points, step);
  const sigma = clamp(L * 0.035, 6, 28);
  const smooth = gaussianSmooth(even, sigma / step);
  const eps = clamp(L * 0.012, 1.5, 6);
  const simplified = rdp(smooth, eps);

  if (maxChordDeviation(smooth) <= Math.max(4, chord * 0.05)) return { straight: true, points: [a, b] };
  return { straight: false, points: simplified };
}

/**
 * 그리기를 마친 직후의 가벼운 자동 정리.
 * 모양은 그대로 두고(흔들림 제거는 '보정' 버튼의 역할) 의미 없는 중복점만 없애고,
 * 거의 곧게 그은 선은 완전한 직선으로 만든다.
 */
export function cleanDrawnPath(points: Vec[], zoom: number): CorrectedPath {
  const a = points[0];
  const b = points[points.length - 1];
  const chord = dist(a, b);
  if (points.length <= 2 || chord < 1) return { straight: true, points: [a, b] };
  if (maxChordDeviation(points) <= Math.max(8 / zoom, chord * 0.06)) return { straight: true, points: [a, b] };
  return { straight: false, points: rdp(points, 0.5 / zoom) };
}
