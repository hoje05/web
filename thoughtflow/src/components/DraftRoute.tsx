import { beziersToPathD, catmullRomToBeziers } from '../geometry/curve';
import { nodeRect } from '../geometry/rect';
import type { Doc } from '../model/types';
import { trimStartOutside, type RouteDraft } from '../routing/createRoute';
import { ARROW_PATH } from './RouteView';

/** 그리는 중인 Route 미리보기: 커서를 따라가는 곡선 + 끝의 화살표 */
export function DraftRoute({ doc, draft }: { doc: Doc; draft: RouteDraft }) {
  let pts = draft.points;
  const source = draft.sourceNodeId ? doc.nodes[draft.sourceNodeId] : null;
  if (source) pts = trimStartOutside(pts, nodeRect(source)) ?? [];
  if (pts.length < 2) return null;
  const d = beziersToPathD(catmullRomToBeziers(pts));
  const end = pts[pts.length - 1];
  // 끝 방향은 마지막 몇 px 구간으로 추정 (마지막 점 하나만 쓰면 흔들림)
  let k = pts.length - 2;
  while (k > 0 && Math.hypot(end.x - pts[k].x, end.y - pts[k].y) < 10) k--;
  const angle = (Math.atan2(end.y - pts[k].y, end.x - pts[k].x) * 180) / Math.PI;
  return (
    <g className="route route-draft" data-testid="route-draft">
      <path className="route-line" d={d} />
      <g transform={`translate(${end.x} ${end.y}) rotate(${angle})`}>
        <path className="route-arrow" d={ARROW_PATH} transform="translate(-4 0)" />
      </g>
    </g>
  );
}
