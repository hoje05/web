/**
 * Doc에 대한 순수 함수 연산. 항상 새 객체를 반환하고 입력을 변경하지 않는다.
 * (Undo/Redo는 Doc snapshot을 그대로 보관하는 방식이므로 불변성이 중요하다)
 */
import { DEFAULT_BOX_HEIGHT, DEFAULT_BOX_WIDTH, type BoxNode, type Doc, type RouteEdge } from './types';

export function addNode(doc: Doc, node: BoxNode): Doc {
  return { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
}

export function makeNode(id: string, center: { x: number; y: number }): BoxNode {
  return {
    id,
    x: Math.round(center.x - DEFAULT_BOX_WIDTH / 2),
    y: Math.round(center.y - DEFAULT_BOX_HEIGHT / 2),
    width: DEFAULT_BOX_WIDTH,
    height: DEFAULT_BOX_HEIGHT,
    text: '',
  };
}

export function updateNode(doc: Doc, id: string, patch: Partial<Omit<BoxNode, 'id'>>): Doc {
  const node = doc.nodes[id];
  if (!node) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, ...patch } } };
}

/** 겹쳤을 때 위에 보이도록 맨 뒤(= 맨 위)로 옮긴다 */
export function bringToFront(doc: Doc, id: string): Doc {
  const node = doc.nodes[id];
  const keys = Object.keys(doc.nodes);
  if (!node || keys[keys.length - 1] === id) return doc;
  const nodes = { ...doc.nodes };
  delete nodes[id];
  nodes[id] = node;
  return { ...doc, nodes };
}

export function setNodePosition(doc: Doc, id: string, x: number, y: number): Doc {
  const node = doc.nodes[id];
  if (!node || (node.x === x && node.y === y)) return doc;
  return updateNode(doc, id, { x, y });
}

export function setNodeText(doc: Doc, id: string, text: string): Doc {
  const node = doc.nodes[id];
  if (!node || node.text === text) return doc;
  return updateNode(doc, id, { text });
}

/** Box와 연결된 Route도 함께 삭제한다 (MVP 정책) */
export function removeNode(doc: Doc, id: string): Doc {
  if (!doc.nodes[id]) return doc;
  const nodes = { ...doc.nodes };
  delete nodes[id];
  const edges = Object.fromEntries(
    Object.entries(doc.edges).filter(([, e]) => e.sourceNodeId !== id && e.targetNodeId !== id),
  );
  return { nodes, edges };
}

export function removeEdge(doc: Doc, id: string): Doc {
  if (!doc.edges[id]) return doc;
  const edges = { ...doc.edges };
  delete edges[id];
  return { ...doc, edges };
}

export function addEdge(doc: Doc, edge: RouteEdge): Doc {
  return { ...doc, edges: { ...doc.edges, [edge.id]: edge } };
}

export function updateEdge(doc: Doc, id: string, patch: Partial<Omit<RouteEdge, 'id'>>): Doc {
  const edge = doc.edges[id];
  if (!edge) return doc;
  return { ...doc, edges: { ...doc.edges, [id]: { ...edge, ...patch } } };
}
