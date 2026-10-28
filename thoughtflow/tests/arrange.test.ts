import { describe, expect, it } from 'vitest';
import { nodeRect, type Rect } from '../src/geometry/rect';
import { arrangeDoc, COL_GAP, GROUP_GAP, ROW_GAP } from '../src/layout/arrange';
import type { BoxNode, Doc, RouteEdge } from '../src/model/types';
import { computeRouteGeometry } from '../src/routing/routeGeometry';

const box = (id: string, x = 0, y = 0, width = 180, height = 56): BoxNode => ({ id, x, y, width, height, text: id, note: '' });
const route = (id: string, from: string, to: string): RouteEdge => ({
  id,
  sourceNodeId: from,
  targetNodeId: to,
  sourceAnchor: { side: 'right' },
  targetAnchor: { side: 'left' },
  pathPoints: [],
  pathMode: 'auto',
});
const make = (nodes: BoxNode[], edges: [string, string][]): Doc => ({
  tags: {},
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  edges: Object.fromEntries(edges.map(([a, b], i) => [`e${i}`, route(`e${i}`, a, b)])),
});
const cy = (n: BoxNode) => n.y + n.height / 2;
const overlap = (a: Rect, b: Rect, m = 0) => a.x < b.x + b.width + m && b.x < a.x + a.width + m && a.y < b.y + b.height + m && b.y < a.y + a.height + m;

function overlapsOf(doc: Doc): string[] {
  const ns = Object.values(doc.nodes);
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (overlap(nodeRect(ns[i]), nodeRect(ns[j]), 8)) out.push(`${ns[i].id}/${ns[j].id}`);
  return out;
}

/** Route가 양 끝이 아닌 Box 안을 지나가는 곳 */
function routeHits(doc: Doc): string[] {
  const geo = computeRouteGeometry(doc);
  const out: string[] = [];
  for (const e of Object.values(doc.edges)) {
    const g = geo.get(e.id)!;
    for (const n of Object.values(doc.nodes)) {
      if (n.id === e.sourceNodeId || n.id === e.targetNodeId) continue;
      const r = nodeRect(n);
      const inner = { x: r.x + 2, y: r.y + 2, width: r.width - 4, height: r.height - 4 };
      if (g.polyline.some((p) => p.x > inner.x && p.x < inner.x + inner.width && p.y > inner.y && p.y < inner.y + inner.height)) out.push(`${e.id}→${n.id}`);
    }
  }
  return out;
}

describe('정렬 (arrangeDoc)', () => {
  it('한 줄 흐름: 왼쪽 → 오른쪽, 같은 높이, 일정한 간격', () => {
    const doc = make([box('a', 500, 400), box('b', 0, 0), box('c', 900, -300, 240), box('d', 100, 700)], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
    const r = arrangeDoc(doc).nodes;
    expect(new Set([cy(r.a), cy(r.b), cy(r.c), cy(r.d)]).size).toBe(1);
    expect(r.b.x - (r.a.x + r.a.width)).toBe(COL_GAP);
    expect(r.c.x - (r.b.x + r.b.width)).toBe(COL_GAP);
    expect(r.d.x - (r.c.x + r.c.width)).toBe(COL_GAP);
  });

  it('원래 내용의 왼쪽 위에서 시작한다', () => {
    const doc = make([box('a', 300, 200), box('b', 50, 600), box('c', 900, 120)], [['a', 'b'], ['a', 'c']]);
    const r = Object.values(arrangeDoc(doc).nodes);
    expect(Math.min(...r.map((n) => n.x))).toBe(50);
    expect(Math.min(...r.map((n) => n.y))).toBe(120);
  });

  it('갈래: 앞 Box는 뒤 Box들의 가운데, 뒤 Box들은 원래 위아래 순서', () => {
    const doc = make([box('p'), box('x', 0, 300), box('y', 0, -200), box('z', 0, 100)], [['p', 'x'], ['p', 'y'], ['p', 'z']]);
    const r = arrangeDoc(doc).nodes;
    expect(r.y.y < r.z.y && r.z.y < r.x.y).toBe(true);
    expect(cy(r.p)).toBe(cy(r.z));
    expect(r.z.y - (r.y.y + r.y.height)).toBe(ROW_GAP);
  });

  it('마름모: 갈라졌다 다시 만나는 흐름은 대칭', () => {
    const doc = make([box('a'), box('b', 0, -50), box('c', 0, 50), box('d')], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]);
    const r = arrangeDoc(doc).nodes;
    expect(cy(r.a)).toBe(cy(r.d));
    expect(cy(r.a) - cy(r.b)).toBe(cy(r.c) - cy(r.a));
    expect(r.b.x).toBe(r.c.x);
  });

  it('순환: 되돌아가는 Route는 왼쪽 면에서 나가 통로로 돌아간다', () => {
    const doc = make([box('a', 0, 0), box('b', 300, 0), box('c', 600, 0)], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    const out = arrangeDoc(doc);
    const r = out.nodes;
    expect(r.a.x < r.b.x && r.b.x < r.c.x).toBe(true);
    const backEdge = out.edges.e2;
    expect([backEdge.sourceAnchor.side, backEdge.targetAnchor.side]).toEqual(['left', 'right']);
    expect(backEdge.pathMode).toBe('smoothed');
    expect(out.edges.e0.sourceAnchor.side).toBe('right');
    expect(overlapsOf(out)).toEqual([]);
    expect(routeHits(out)).toEqual([]);
  });

  it('두 Box가 서로 가리키면 겹치지 않는 두 줄', () => {
    const out = arrangeDoc(make([box('a'), box('b', 400, 0)], [['a', 'b'], ['b', 'a']]));
    expect(out.edges.e0.sourceAnchor.side).toBe('right');
    expect(out.edges.e1.sourceAnchor.side).toBe('left');
  });

  it('여러 열을 건너뛰는 Route는 사이 Box를 피해 통로로 지나간다', () => {
    const doc = make([box('a'), box('b', 200, 0), box('c', 400, 0), box('d', 600, 0)], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'd']]);
    const out = arrangeDoc(doc);
    expect(out.edges.e3.pathMode).toBe('smoothed');
    expect(out.edges.e3.pathPoints.length).toBe(6);
    expect(routeHits(out)).toEqual([]);
    expect(overlapsOf(out)).toEqual([]);
  });

  it('따로 떨어진 묶음은 원래 위 → 아래 순서로 쌓고, Route 없는 Box는 맨 아래 한 줄', () => {
    const doc = make(
      [box('a1', 0, 500), box('a2', 300, 500), box('b1', 0, 0), box('b2', 300, 0), box('b3', 600, 0), box('l1', 800, 900), box('l2', 0, 950, 220)],
      [['a1', 'a2'], ['b1', 'b2'], ['b2', 'b3']],
    );
    const r = arrangeDoc(doc).nodes;
    expect(r.a1.y - (r.b1.y + r.b1.height)).toBe(GROUP_GAP);
    expect(r.l1.y).toBe(r.l2.y);
    expect(r.l1.y).toBeGreaterThan(r.a1.y + r.a1.height);
    expect(r.l1.x).toBeLessThan(r.l2.x); // 원래 위쪽(900)에 있던 l1이 먼저
  });

  it('이미 정렬된 보드는 그대로 (같은 Doc)', () => {
    const doc = make(
      [box('a'), box('b', 100, 300), box('c', 50, -100), box('d', 400, 30), box('e', 700, 500), box('f', 20, 900)],
      [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'a'], ['b', 'e']],
    );
    const once = arrangeDoc(doc);
    expect(once).not.toBe(doc);
    expect(arrangeDoc(once)).toBe(once);
  });

  it('Box 크기·글·메모는 그대로, 위치와 Route 모양만 바뀐다', () => {
    const doc = make([{ ...box('a', 10, 10, 230, 90), note: '메모' }, box('b', 5, 5)], [['a', 'b']]);
    doc.edges.e0 = { ...doc.edges.e0, pathMode: 'smoothed', pathPoints: [[0.3, 0.4]], sourceAnchor: { side: 'bottom' }, targetAnchor: { side: 'top' } };
    const out = arrangeDoc(doc);
    expect({ ...out.nodes.a, x: 0, y: 0 }).toEqual({ ...doc.nodes.a, x: 0, y: 0 });
    expect(out.edges.e0).toMatchObject({ pathMode: 'auto', pathPoints: [], sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' } });
  });

  it('빈 보드는 그대로', () => {
    const doc: Doc = { nodes: {}, edges: {}, tags: {} };
    expect(arrangeDoc(doc)).toBe(doc);
  });

  it('무작위 보드: 겹치지 않고, 앞으로 가는 Route는 오른쪽으로, Route가 다른 Box를 지나지 않는다', () => {
    let seed = 11;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let hits = 0;
    let routes = 0;
    for (let k = 0; k < 120; k++) {
      const n = 3 + Math.floor(rand() * 14);
      const nodes = Array.from({ length: n }, (_, i) =>
        box(`n${i}`, Math.round(rand() * 1600), Math.round(rand() * 1000), 140 + Math.round(rand() * 160), 48 + Math.round(rand() * 60)),
      );
      const edges: [string, string][] = [];
      const m = Math.floor(rand() * n * 1.6);
      for (let j = 0; j < m; j++) {
        const a = Math.floor(rand() * n);
        const b = Math.floor(rand() * n);
        if (a !== b) edges.push([`n${a}`, `n${b}`]);
      }
      const out = arrangeDoc(make(nodes, edges));
      expect(overlapsOf(out), `board ${k}`).toEqual([]);
      for (const e of Object.values(out.edges)) {
        const a = out.nodes[e.sourceNodeId];
        const b = out.nodes[e.targetNodeId];
        if (e.sourceAnchor.side === 'right') expect(b.x, `board ${k} ${e.id}`).toBeGreaterThan(a.x + a.width);
        else expect(a.x, `board ${k} ${e.id}`).toBeGreaterThan(b.x + b.width);
      }
      expect(arrangeDoc(out), `board ${k} stable`).toBe(out);
      hits += routeHits(out).length;
      routes += edges.length;
    }
    expect(hits, `${hits} of ${routes} routes cross another box`).toBe(0);
  });
});

describe('정렬 — 들어오는 흐름 중심 (Incoming)', () => {
  const col = (d: Doc, id: string) => d.nodes[id].x + d.nodes[id].width / 2;
  const IN = { mode: 'in' as const };

  it('선택한 C를 중심으로: E → B는 왼쪽, A·B·D는 C로 모인다 (A→C, B→C, D→C, E→B)', () => {
    const doc = make([box('a', 0, 300), box('b', 0, 0), box('c', 400, 150), box('d', 0, 600), box('e', -400, 0)], [['a', 'c'], ['b', 'c'], ['d', 'c'], ['e', 'b']]);
    const r = arrangeDoc(doc, { mode: 'in', center: 'c' });
    const n = r.nodes;
    expect(col(r, 'a')).toBe(col(r, 'b'));
    expect(col(r, 'b')).toBe(col(r, 'd'));
    expect(col(r, 'e')).toBeLessThan(col(r, 'b'));
    expect(col(r, 'c')).toBeGreaterThan(col(r, 'a'));
    // C는 들어오는 Box들의 가운데 높이, E → B 는 한 줄
    const ys = ['a', 'b', 'd'].map((id) => cy(n[id])).sort((p, q) => p - q);
    expect(cy(n.c)).toBe(ys[1]);
    expect(cy(n.e)).toBe(cy(n.b));
    expect(overlapsOf(r)).toEqual([]);
    expect(routeHits(r)).toEqual([]);
  });

  it('나가는 흐름과 다른 점: 중간 Box는 뒤 Box 바로 앞 열로 (A→B→C→D, A→E, E→D)', () => {
    const doc = make([box('a', 0, 0), box('b', 300, 0), box('c', 600, 0), box('d', 900, 0), box('e', 300, 200)], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'e'], ['e', 'd']]);
    const out = arrangeDoc(doc);
    const inn = arrangeDoc(doc, IN);
    expect(col(out, 'e')).toBe(col(out, 'b')); // 나가는 흐름: A 바로 다음
    expect(col(inn, 'e')).toBe(col(inn, 'c')); // 들어오는 흐름: D 바로 앞
    expect(overlapsOf(inn)).toEqual([]);
  });

  it('선택이 없으면 묶음마다 흐름의 끝 Box가 중심 (여러 끝이면 가장 많은 흐름이 모이는 Box)', () => {
    // 끝: d (a,b,c가 모임), x (b만). 중심 = d → a·b·c는 d를 향해, x는 b 바로 다음
    const doc = make([box('a', 0, 0), box('b', 0, 200), box('c', 300, 100), box('d', 600, 100), box('x', 300, 400)], [['a', 'c'], ['b', 'c'], ['c', 'd'], ['b', 'x']]);
    const r = arrangeDoc(doc, IN);
    expect(col(r, 'd')).toBeGreaterThan(col(r, 'c'));
    expect(col(r, 'c')).toBeGreaterThan(col(r, 'a'));
    expect(col(r, 'a')).toBe(col(r, 'b'));
    expect(col(r, 'x')).toBe(col(r, 'c'));
  });

  it('중심이 끝이 아니어도: 앞 흐름은 왼쪽, 뒤 흐름은 오른쪽 (A → B → C, B 선택)', () => {
    const doc = make([box('a', 600, 0), box('b', 300, 300), box('c', 0, 0)], [['a', 'b'], ['b', 'c']]);
    const r = arrangeDoc(doc, { mode: 'in', center: 'b' });
    expect(col(r, 'a')).toBeLessThan(col(r, 'b'));
    expect(col(r, 'b')).toBeLessThan(col(r, 'c'));
  });

  it('순환이 있어도 멈추고, 중심으로 들어오는 Route는 앞으로 간다 (A → B → C → A)', () => {
    const doc = make([box('a', 0, 0), box('b', 300, 0), box('c', 150, 200)], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    for (const center of ['a', 'b', 'c', null]) {
      const r = arrangeDoc(doc, { mode: 'in', center });
      expect(overlapsOf(r)).toEqual([]);
      if (center) {
        // 중심으로 들어오는 Route: 오른쪽 면 → 왼쪽 면 (되돌아가지 않음)
        const into = Object.values(r.edges).find((e) => e.targetNodeId === center)!;
        expect(into.sourceAnchor.side).toBe('right');
        expect(col(r, center)).toBe(Math.max(...['a', 'b', 'c'].map((id) => col(r, id))));
      }
      expect(arrangeDoc(r, { mode: 'in', center })).toBe(r);
    }
  });

  it('나가는 흐름 + 선택: 그 Box에서 나가는 흐름 기준 (순환을 그 Box부터 끊는다)', () => {
    const doc = make([box('a', 0, 0), box('b', 300, 0), box('c', 150, 200)], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    const r = arrangeDoc(doc, { mode: 'out', center: 'c' });
    expect(col(r, 'c')).toBeLessThan(col(r, 'a'));
    expect(col(r, 'a')).toBeLessThan(col(r, 'b'));
    // 선택이 없으면 기존 정렬 그대로
    expect(arrangeDoc(doc, { mode: 'out' })).toEqual(arrangeDoc(doc));
    expect(arrangeDoc(doc, { mode: 'out', center: null })).toEqual(arrangeDoc(doc));
  });

  it('위치와 Route 모양만 바뀐다: id, 방향, 글, 메모, 태그, 첨부는 그대로', () => {
    const doc = make([box('a', 0, 300), box('b', 500, 0), box('c', 200, 150)], [['a', 'b'], ['c', 'b']]);
    doc.tags = { t: { id: 't', name: 'AI', normalizedName: 'ai', active: true } };
    doc.nodes.a = {
      ...doc.nodes.a,
      note: '메모',
      tagIds: ['t'],
      attachments: [{ id: 'x', type: 'file', name: 'r.csv', relativePath: 'assets/1-r.csv', mimeType: 'text/csv', size: 3 }],
    };
    const r = arrangeDoc(doc, { mode: 'in', center: 'b' });
    expect(r).not.toBe(doc);
    expect(r.tags).toBe(doc.tags);
    for (const id of Object.keys(doc.nodes)) {
      const { x: _x, y: _y, ...rest } = r.nodes[id];
      const { x: _ox, y: _oy, ...orig } = doc.nodes[id];
      expect(rest).toEqual(orig);
    }
    for (const e of Object.values(doc.edges)) {
      expect([r.edges[e.id].sourceNodeId, r.edges[e.id].targetNodeId]).toEqual([e.sourceNodeId, e.targetNodeId]);
    }
  });

  it('무작위 보드 (들어오는 흐름, 중심 있음·없음): 겹치지 않고, Route는 오른쪽으로, 다시 정렬해도 그대로', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let hits = 0;
    let routes = 0;
    let unstable = 0;
    for (let k = 0; k < 150; k++) {
      const n = 3 + Math.floor(rand() * 14);
      const nodes = Array.from({ length: n }, (_, i) =>
        box(`n${i}`, Math.round(rand() * 1600), Math.round(rand() * 1000), 140 + Math.round(rand() * 160), 48 + Math.round(rand() * 60)),
      );
      const edges: [string, string][] = [];
      const m = Math.floor(rand() * n * 1.6);
      for (let j = 0; j < m; j++) {
        const a = Math.floor(rand() * n);
        const b = Math.floor(rand() * n);
        if (a !== b) edges.push([`n${a}`, `n${b}`]);
      }
      const opts = { mode: 'in' as const, center: k % 2 ? `n${Math.floor(rand() * n)}` : null };
      const out = arrangeDoc(make(nodes, edges), opts);
      expect(overlapsOf(out), `board ${k}`).toEqual([]);
      for (const e of Object.values(out.edges)) {
        const a = out.nodes[e.sourceNodeId];
        const b = out.nodes[e.targetNodeId];
        if (e.sourceAnchor.side === 'right') expect(b.x, `board ${k} ${e.id}`).toBeGreaterThan(a.x + a.width);
        else expect(a.x, `board ${k} ${e.id}`).toBeGreaterThan(b.x + b.width);
      }
      if (arrangeDoc(out, opts) !== out) unstable++;
      hits += routeHits(out).length;
      routes += edges.length;
    }
    expect(unstable, 'boards that change when arranged again').toBe(0);
    // 되돌아가는 통로 곡선이 Box 모서리를 몇 px 스치는 드문 경우가 있다 (나가는 흐름 정렬과 같은 수준)
    expect(hits / routes, `${hits} of ${routes} routes cross another box`).toBeLessThan(0.005);
  });
});
