import { describe, expect, it } from 'vitest';
import { computeAnchors, distributionT } from '../src/anchors/distribution';
import { straightSides, sideForDirection } from '../src/anchors/sideSelection';
import type { BoxNode, Doc, RouteEdge, Side } from '../src/model/types';
import { moveNode, reverseRoute } from '../src/routing/routeOps';

const box = (id: string, x: number, y: number): BoxNode => ({ id, x, y, width: 180, height: 60, text: id, note: '' });
const edge = (id: string, s: string, t: string, ss: Side, ts: Side): RouteEdge => ({
  id,
  sourceNodeId: s,
  targetNodeId: t,
  sourceAnchor: { side: ss },
  targetAnchor: { side: ts },
  pathPoints: [],
  pathMode: 'straight',
});
const docOf = (nodes: BoxNode[], edges: RouteEdge[]): Doc => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  edges: Object.fromEntries(edges.map((e) => [e.id, e])),
});

describe('anchor distribution', () => {
  it('spreads anchors evenly: 1 → center, 2 → thirds, 3 → quarters', () => {
    expect(distributionT(0, 1)).toBe(0.5);
    expect([distributionT(0, 2), distributionT(1, 2)]).toEqual([1 / 3, 2 / 3]);
    expect([0, 1, 2].map((i) => distributionT(i, 3))).toEqual([0.25, 0.5, 0.75]);
  });

  it('orders anchors on a side to avoid crossings', () => {
    // A의 right 면에서 위쪽 B, 아래쪽 C로 나가는 Route
    const doc = docOf(
      [box('A', 0, 0), box('B', 400, -200), box('C', 400, 200)],
      [edge('e2', 'A', 'C', 'right', 'left'), edge('e1', 'A', 'B', 'right', 'left')],
    );
    const a = computeAnchors(doc);
    const toB = a.get('e1')!.source;
    const toC = a.get('e2')!.source;
    expect(toB.x).toBe(180);
    expect(toB.y).toBeCloseTo(20); // 60 * 1/3
    expect(toC.y).toBeCloseTo(40); // 60 * 2/3
  });

  it('single route stays at the side center', () => {
    const doc = docOf([box('A', 0, 0), box('B', 400, 0)], [edge('e', 'A', 'B', 'right', 'left')]);
    const a = computeAnchors(doc).get('e')!;
    expect(a.source).toEqual({ x: 180, y: 30 });
    expect(a.target).toEqual({ x: 400, y: 30 });
  });
});

describe('side selection', () => {
  const r = (x: number, y: number) => ({ x, y, width: 180, height: 60 });
  it('picks horizontal sides for side-by-side boxes', () => {
    expect(straightSides(r(0, 0), r(400, 40))).toEqual(['right', 'left']);
    expect(straightSides(r(400, 40), r(0, 0))).toEqual(['left', 'right']);
  });
  it('picks vertical sides for stacked boxes', () => {
    expect(straightSides(r(0, 0), r(40, 300))).toEqual(['bottom', 'top']);
  });
  it('hysteresis keeps the current axis near the diagonal', () => {
    // 가로 간격 120, 세로 간격 130 → 거의 대각선: 현재 좌/우 면이면 유지
    expect(straightSides(r(0, 0), r(300, 190), ['right', 'left'])).toEqual(['right', 'left']);
    expect(straightSides(r(0, 0), r(300, 190))).toEqual(['bottom', 'top']);
  });
  it('curve direction uses the tangent', () => {
    expect(sideForDirection({ x: 0.2, y: -1 })).toBe('top');
    expect(sideForDirection({ x: 1, y: 0.9 }, 'bottom')).toBe('bottom');
  });
});

describe('route ops', () => {
  it('moving a box re-evaluates sides of its routes', () => {
    let doc = docOf([box('A', 0, 0), box('B', 400, 0)], [edge('e', 'A', 'B', 'right', 'left')]);
    doc = moveNode(doc, 'B', 0, 400); // B를 A 아래로
    expect(doc.edges.e.sourceAnchor.side).toBe('bottom');
    expect(doc.edges.e.targetAnchor.side).toBe('top');
  });
  it('reverse swaps endpoints and anchors', () => {
    const doc = reverseRoute(docOf([box('A', 0, 0), box('B', 400, 0)], [edge('e', 'A', 'B', 'right', 'left')]), 'e');
    expect(doc.edges.e.sourceNodeId).toBe('B');
    expect(doc.edges.e.sourceAnchor.side).toBe('left');
  });
});
