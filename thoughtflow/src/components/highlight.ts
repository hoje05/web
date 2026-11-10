import type { RouteEdge, Selection } from '../model/types';

/**
 * 선택 상태에 따른 Route의 시각적 역할 — Data에 저장하지 않고 렌더링 때 계산한다.
 *  outgoing: 선택한 Box → 다른 Box (초록)
 *  incoming: 다른 Box → 선택한 Box (보라)
 *  dim:      선택한 Box와 무관 (약간 흐리게, 구조는 유지)
 */
export type RouteRole = 'normal' | 'selected' | 'outgoing' | 'incoming' | 'dim';

export function routeRole(edge: RouteEdge, selection: Selection): RouteRole {
  if (!selection) return 'normal';
  if (selection.kind === 'edge') return edge.id === selection.id ? 'selected' : 'normal';
  if (edge.sourceNodeId === selection.id) return 'outgoing';
  if (edge.targetNodeId === selection.id) return 'incoming';
  return 'dim';
}
