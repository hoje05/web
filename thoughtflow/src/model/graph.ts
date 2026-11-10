import type { Doc, RouteEdge } from './types';

/** N에서 나가는 Route: edge.sourceNodeId === N */
export const outgoingEdges = (doc: Doc, nodeId: string): RouteEdge[] =>
  Object.values(doc.edges).filter((e) => e.sourceNodeId === nodeId);

/** N으로 들어오는 Route: edge.targetNodeId === N */
export const incomingEdges = (doc: Doc, nodeId: string): RouteEdge[] =>
  Object.values(doc.edges).filter((e) => e.targetNodeId === nodeId);

/** 가장 최근에 연결된 이웃 Box (Tab 이동용) */
export function neighborNode(doc: Doc, nodeId: string, dir: 'incoming' | 'outgoing'): string | null {
  const edges = dir === 'outgoing' ? outgoingEdges(doc, nodeId) : incomingEdges(doc, nodeId);
  const last = edges[edges.length - 1];
  if (!last) return null;
  return dir === 'outgoing' ? last.targetNodeId : last.sourceNodeId;
}
