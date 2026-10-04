/**
 * 정렬: Box와 Route를 흐름 순서대로 보기 좋게 다시 놓는다 (층으로 나누는 Sugiyama 방식).
 *
 *  1. 이어진 Box끼리 묶음으로 나눈다. 묶음마다 왼쪽 → 오른쪽 흐름으로 놓고, 묶음은 원래 위 → 아래 순서로 쌓는다.
 *  2. 열(층): Box는 앞 Box보다 오른쪽 열에 온다. 되돌아가는 Route(순환)는 열을 정할 때만 뒤집어 생각한다.
 *  3. 여러 열을 건너뛰는 Route에는 사이 열마다 빈 통로를 남겨 Box를 가로지르지 않게 한다.
 *  4. 열 안의 순서: 원래 위아래 순서에서 시작해 Route가 덜 엇갈리는 순서로 바꾼다.
 *  5. 세로 위치: 이어진 Box끼리 같은 높이에 오도록 당기되(가운데값), 겹치지 않게 간격을 지킨다.
 *  6. Route: 앞으로 가는 Route는 오른쪽 면 → 왼쪽 면, 되돌아가는 Route는 왼쪽 면 → 오른쪽 면.
 *     건너뛰는 Route는 통로를 지나는 곡선, 나머지는 자동 연결선.
 *  7. Route가 없는 Box는 맨 아래에 줄지어 놓는다. 전체는 원래 내용의 왼쪽 위에서 시작한다.
 *
 * 순수 함수다. 이미 정렬된 보드를 다시 정렬하면 그대로다 (바뀐 것이 없으면 같은 Doc을 돌려준다).
 */
import { computeAnchors } from '../anchors/distribution';
import { fromChord, toChord } from '../geometry/chord';
import { nodeRect, pointOnSide } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { BoxNode, Doc, RouteEdge, Side } from '../model/types';

/** 열 사이 간격 (Route와 화살표가 보일 만큼) */
export const COL_GAP = 110;
/** 같은 열의 Box 사이 간격 */
export const ROW_GAP = 32;
/** 묶음 사이 간격 */
export const GROUP_GAP = 96;
/** Route 없는 Box 사이 가로 간격 */
const LONE_GAP_X = 40;
/** 건너뛰는 Route가 지나갈 통로의 높이와, 통로 양옆 여유 */
const LANE_H = 8;
const LANE_GAP = 20;
/** 통로 Route가 열 끝까지 수평으로 나가는 구간의 최소 길이 */
const STUB_MIN = 60;
const ORDER_SWEEPS = 12;
const ALIGN_ROUNDS = 12;

interface V {
  id: string;
  real: boolean;
  w: number;
  h: number;
  layer: number;
  /** 원래 세로 위치 (순서를 정할 때 처음 기준·동점 처리) */
  key: number;
  preds: V[];
  succs: V[];
  pos: number;
  cy: number;
}

interface GroupLayout {
  pos: Map<string, Vec>;
  /** 건너뛰는 Route가 지나는 통로 점들 (Route 방향 순서) */
  lanes: Map<string, Vec[]>;
  back: Set<string>;
  width: number;
  height: number;
}

const byPosition = (a: BoxNode, b: BoxNode) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function arrangeDoc(doc: Doc): Doc {
  // 정렬한 모양을 기준으로 다시 정렬해도 같아질 때까지 (몇 번이면 멈춘다) → 정렬 버튼을 다시 눌러도 흔들리지 않는다
  let prev = doc;
  let next = arrangeOnce(doc);
  for (let i = 0; i < 6 && next !== prev; i++) {
    prev = next;
    next = arrangeOnce(prev);
  }
  return next;
}

function arrangeOnce(doc: Doc): Doc {
  const nodes = Object.values(doc.nodes);
  if (!nodes.length) return doc;
  const edges = Object.values(doc.edges).filter(
    (e) => doc.nodes[e.sourceNodeId] && doc.nodes[e.targetNodeId] && e.sourceNodeId !== e.targetNodeId,
  );

  // ── 1) 묶음 나누기
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.sourceNodeId)!.push(e.targetNodeId);
    adj.get(e.targetNodeId)!.push(e.sourceNodeId);
  }
  const group = new Map<string, number>();
  const groups: BoxNode[][] = [];
  for (const n of [...nodes].sort(byPosition)) {
    if (group.has(n.id)) continue;
    const members: BoxNode[] = [];
    const queue = [n.id];
    group.set(n.id, groups.length);
    while (queue.length) {
      const id = queue.shift()!;
      members.push(doc.nodes[id]);
      for (const m of adj.get(id)!) {
        if (!group.has(m)) {
          group.set(m, groups.length);
          queue.push(m);
        }
      }
    }
    groups.push(members);
  }
  const linked = groups.filter((g) => g.length > 1);
  const lone = groups.filter((g) => g.length === 1).map((g) => g[0]);
  const top = (g: BoxNode[]) => Math.min(...g.map((n) => n.y));
  const left = (g: BoxNode[]) => Math.min(...g.map((n) => n.x));
  linked.sort((a, b) => top(a) - top(b) || left(a) - left(b));

  // ── 묶음마다 배치하고 위 → 아래로 쌓기
  const pos = new Map<string, Vec>();
  const lanes = new Map<string, Vec[]>();
  const back = new Set<string>();
  let cursor = 0;
  let totalWidth = 0;
  // 지금 화면에서 Route가 실제로 붙어 있는 자리 (그려 둔 통로 높이를 화면과 똑같이 읽기 위해)
  const nowAnchors = computeAnchors(doc);
  for (const g of linked) {
    const ids = new Set(g.map((n) => n.id));
    const res = layoutGroup(
      g,
      edges.filter((e) => ids.has(e.sourceNodeId)),
      nowAnchors,
    );
    for (const [id, p] of res.pos) pos.set(id, { x: p.x, y: p.y + cursor });
    for (const [id, pts] of res.lanes) lanes.set(id, pts.map((p) => ({ x: p.x, y: p.y + cursor })));
    res.back.forEach((id) => back.add(id));
    cursor += res.height + GROUP_GAP;
    totalWidth = Math.max(totalWidth, res.width);
  }

  // ── 7) Route 없는 Box: 맨 아래에 원래 순서대로 줄지어
  if (lone.length) {
    const wrap = Math.max(totalWidth, 760);
    let x = 0;
    let y = cursor;
    let rowH = 0;
    for (const n of [...lone].sort(byPosition)) {
      if (x > 0 && x + n.width > wrap) {
        x = 0;
        y += rowH + ROW_GAP;
        rowH = 0;
      }
      pos.set(n.id, { x, y });
      x += n.width + LONE_GAP_X;
      rowH = Math.max(rowH, n.height);
    }
  }

  // ── 원래 내용의 왼쪽 위에서 시작 (통로가 맨 위에 와도 Box들의 왼쪽 위를 맞춘다)
  const rel = [...pos.values()];
  const ox = Math.min(...nodes.map((n) => n.x)) - Math.min(...rel.map((p) => p.x));
  const oy = Math.min(...nodes.map((n) => n.y)) - Math.min(...rel.map((p) => p.y));
  let changed = false;
  const nextNodes: Record<string, BoxNode> = {};
  for (const n of Object.values(doc.nodes)) {
    const p = pos.get(n.id)!;
    const x = Math.round(ox + p.x);
    const y = Math.round(oy + p.y);
    if (x !== n.x || y !== n.y) {
      changed = true;
      nextNodes[n.id] = { ...n, x, y };
    } else nextNodes[n.id] = n;
  }

  // ── 6) Route: 앞으로 가는 Route는 오른쪽 → 왼쪽 면, 되돌아가는 Route는 왼쪽 → 오른쪽 면. 건너뛰는 Route는 통로를 지나는 곡선.
  const valid = new Set(edges.map((e) => e.id));
  const world = (p: Vec) => ({ x: ox + p.x, y: oy + p.y });
  const planned: Record<string, RouteEdge> = {};
  for (const e of Object.values(doc.edges)) {
    if (!valid.has(e.id)) {
      planned[e.id] = e;
      continue;
    }
    const [sSide, tSide]: [Side, Side] = back.has(e.id) ? ['left', 'right'] : ['right', 'left'];
    planned[e.id] = { ...e, sourceAnchor: { side: sSide }, targetAnchor: { side: tSide }, pathMode: 'auto', pathPoints: [] };
  }
  // 통로 곡선은 Route가 실제로 붙는 자리(한 면에 여럿이면 나눠 붙음) 기준으로 저장해야 그 자리를 정확히 지난다
  const laneChord = (e: RouteEdge, s: Vec, t: Vec) =>
    toChord(lanes.get(e.id)!.map(world), s, t).map(([u, v]) => [round5(u), round5(v)] as [number, number]);
  for (const e of Object.values(planned)) {
    if (!lanes.get(e.id)?.length) continue;
    const s = pointOnSide(nodeRect(nextNodes[e.sourceNodeId]), e.sourceAnchor.side, 0.5);
    const t = pointOnSide(nodeRect(nextNodes[e.targetNodeId]), e.targetAnchor.side, 0.5);
    const chord = laneChord(e, s, t);
    if (chord.length) planned[e.id] = { ...e, pathMode: 'smoothed', pathPoints: chord };
  }
  // 붙는 자리는 곡선 모양을 보고 정해지므로, 둘이 서로 맞아떨어질 때까지 맞춘다.
  // 드물게 두 상태를 번갈아 오가면 그중 늘 같은 하나를 고른다 (다시 정렬해도 같은 결과).
  const laneIds = Object.values(planned).filter((p) => p.pathMode === 'smoothed' && valid.has(p.id)).map((p) => p.id);
  const stateOf = () => JSON.stringify(laneIds.map((id) => planned[id].pathPoints));
  const seen: string[] = [stateOf()];
  for (let round = 0; round < 8 && laneIds.length; round++) {
    const anchors = computeAnchors({ nodes: nextNodes, edges: planned });
    for (const id of laneIds) {
      const a = anchors.get(id);
      const chord = a ? laneChord(planned[id], a.source, a.target) : [];
      if (chord.length) planned[id] = { ...planned[id], pathPoints: chord };
    }
    const state = stateOf();
    const at = seen.indexOf(state);
    if (at === seen.length - 1) break;
    if (at >= 0) {
      const pick = seen.slice(at).sort()[0];
      const chords = JSON.parse(pick) as RouteEdge['pathPoints'][];
      laneIds.forEach((id, i) => (planned[id] = { ...planned[id], pathPoints: chords[i] }));
      break;
    }
    seen.push(state);
  }
  const nextEdges: Record<string, RouteEdge> = {};
  for (const e of Object.values(doc.edges)) {
    const p = planned[e.id];
    const same =
      e.sourceAnchor.side === p.sourceAnchor.side &&
      e.targetAnchor.side === p.targetAnchor.side &&
      e.pathMode === p.pathMode &&
      JSON.stringify(e.pathPoints) === JSON.stringify(p.pathPoints);
    if (same) nextEdges[e.id] = e;
    else {
      changed = true;
      nextEdges[e.id] = p;
    }
  }
  return changed ? { nodes: nextNodes, edges: nextEdges } : doc;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

function layoutGroup(group: BoxNode[], gEdges: RouteEdge[], nowAnchors: Map<string, { source: Vec; target: Vec }>): GroupLayout {
  const byId = new Map(group.map((n) => [n.id, n]));
  const outgoing = new Map<string, RouteEdge[]>(group.map((n) => [n.id, []]));
  const indeg = new Map<string, number>(group.map((n) => [n.id, 0]));
  for (const e of gEdges) {
    outgoing.get(e.sourceNodeId)!.push(e);
    indeg.set(e.targetNodeId, indeg.get(e.targetNodeId)! + 1);
  }
  const before = (a: BoxNode, b: BoxNode) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1);
  for (const list of outgoing.values()) list.sort((a, b) => before(byId.get(a.targetNodeId)!, byId.get(b.targetNodeId)!));

  // ── 2) 순환 끊기: 원래 왼쪽에 있던 시작 Box부터 깊이 우선으로 훑고, 지금 지나는 길 위의 Box로 돌아가는 Route를 "되돌아감"으로
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const starts = [...group].sort((a, b) => Number(indeg.get(a.id)! > 0) - Number(indeg.get(b.id)! > 0) || before(a, b));
  for (const s of starts) {
    if (state.has(s.id)) continue;
    state.set(s.id, 1);
    const stack: { id: string; i: number }[] = [{ id: s.id, i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = outgoing.get(top.id)!;
      if (top.i < list.length) {
        const e = list[top.i++];
        const st = state.get(e.targetNodeId);
        if (st === 1) back.add(e.id);
        else if (st === undefined) {
          state.set(e.targetNodeId, 1);
          stack.push({ id: e.targetNodeId, i: 0 });
        }
      } else {
        state.set(top.id, 2);
        stack.pop();
      }
    }
  }
  const dag = gEdges.map((e) =>
    back.has(e.id) ? { from: e.targetNodeId, to: e.sourceNodeId, edge: e } : { from: e.sourceNodeId, to: e.targetNodeId, edge: e },
  );

  // ── 열: 가장 긴 길 (앞 Box들 중 가장 오른쪽 + 1)
  const ins = new Map<string, string[]>(group.map((n) => [n.id, []]));
  const outs = new Map<string, string[]>(group.map((n) => [n.id, []]));
  for (const d of dag) {
    ins.get(d.to)!.push(d.from);
    outs.get(d.from)!.push(d.to);
  }
  const order: string[] = [];
  const remaining = new Map(group.map((n) => [n.id, ins.get(n.id)!.length]));
  const ready = group.filter((n) => remaining.get(n.id) === 0).sort(before).map((n) => n.id);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of outs.get(id)!) {
      remaining.set(t, remaining.get(t)! - 1);
      if (remaining.get(t) === 0) ready.push(t);
    }
  }
  const layer = new Map<string, number>();
  for (const id of order) layer.set(id, Math.max(0, ...ins.get(id)!.map((p) => layer.get(p)! + 1)));
  // 시작 Box는 뒤 Box 바로 앞 열로 당긴다 (긴 Route 줄이기)
  for (const id of [...order].reverse()) {
    if (ins.get(id)!.length === 0 && outs.get(id)!.length) layer.set(id, Math.min(...outs.get(id)!.map((t) => layer.get(t)!)) - 1);
  }
  const minLayer = Math.min(...layer.values());
  for (const [id, l] of layer) layer.set(id, l - minLayer);
  const maxLayer = Math.max(...layer.values());

  // ── 3) 가상 Box(통로)
  // 열마다 원래 가운데 x (이미 정렬된 보드라면 그 열의 정확한 가운데) → 그려 둔 통로 높이를 읽을 때 쓴다
  const colMidSum = new Map<number, { sum: number; n: number }>();
  for (const n of group) {
    const c = colMidSum.get(layer.get(n.id)!) ?? { sum: 0, n: 0 };
    c.sum += n.x + n.width / 2;
    c.n++;
    colMidSum.set(layer.get(n.id)!, c);
  }
  /** 그려 둔 곡선이 열 l의 가운데를 지나는 높이 (곡선 점 중 그 열 가운데에 가장 가까운 점) */
  const laneY = (e: RouteEdge, l: number): number | null => {
    const mid = colMidSum.get(l);
    if (!mid || e.pathMode !== 'smoothed' || !e.pathPoints.length) return null;
    const cx = mid.sum / mid.n;
    const a = nowAnchors.get(e.id);
    const s0 = a?.source ?? pointOnSide(nodeRect(byId.get(e.sourceNodeId)!), e.sourceAnchor.side, 0.5);
    const t0 = a?.target ?? pointOnSide(nodeRect(byId.get(e.targetNodeId)!), e.targetAnchor.side, 0.5);
    let best: Vec | null = null;
    for (const p of fromChord(e.pathPoints, s0, t0)) if (!best || Math.abs(p.x - cx) < Math.abs(best.x - cx)) best = p;
    return best && Math.abs(best.x - cx) < 1 ? best.y : null;
  };
  const vs = new Map<string, V>();
  for (const n of group) {
    vs.set(n.id, { id: n.id, real: true, w: n.width, h: n.height, layer: layer.get(n.id)!, key: n.y + n.height / 2, preds: [], succs: [], pos: 0, cy: 0 });
  }
  const link = (a: V, b: V) => {
    a.succs.push(b);
    b.preds.push(a);
  };
  const chains = new Map<string, V[]>();
  for (const d of dag) {
    const a = vs.get(d.from)!;
    const b = vs.get(d.to)!;
    const span = b.layer - a.layer;
    if (span <= 1) {
      link(a, b);
      continue;
    }
    const chain: V[] = [];
    let prev = a;
    for (let l = a.layer + 1; l < b.layer; l++) {
      // 이미 정렬된 Route면 지금 지나는 통로 높이에서 시작한다 (다시 정렬해도 같은 순서 → 같은 모양)
      const key = laneY(d.edge, l) ?? a.key + ((b.key - a.key) * (l - a.layer)) / span;
      const v: V = { id: `${d.edge.id}#${l}`, real: false, w: 0, h: LANE_H, layer: l, key, preds: [], succs: [], pos: 0, cy: 0 };
      vs.set(v.id, v);
      link(prev, v);
      chain.push(v);
      prev = v;
    }
    link(prev, b);
    chains.set(d.edge.id, chain);
  }

  // ── 4) 열 안의 순서
  const layers: V[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const v of vs.values()) layers[v.layer].push(v);
  const tie = (a: V, b: V) => a.key - b.key || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const l of layers) {
    l.sort(tie);
    l.forEach((v, i) => (v.pos = i));
  }
  const snapshot = () => layers.map((l) => [...l]);
  let best = snapshot();
  let bestCross = crossings(layers);
  for (let it = 0; it < ORDER_SWEEPS && bestCross > 0; it++) {
    const down = it % 2 === 0;
    for (let k = 1; k <= maxLayer; k++) {
      const l = down ? k : maxLayer - k;
      const bc = new Map<V, number>();
      for (const v of layers[l]) {
        const nb = down ? v.preds : v.succs;
        bc.set(v, nb.length ? nb.reduce((s, n) => s + n.pos, 0) / nb.length : v.pos);
      }
      layers[l].sort((a, b) => bc.get(a)! - bc.get(b)! || tie(a, b));
      layers[l].forEach((v, i) => (v.pos = i));
    }
    const c = crossings(layers);
    if (c < bestCross) {
      bestCross = c;
      best = snapshot();
    }
  }
  best.forEach((l, i) => {
    layers[i] = l;
    l.forEach((v, j) => (v.pos = j));
  });

  // ── 5) 가로: 열 너비 / 세로: 이어진 Box끼리 같은 높이로 당기기
  const colW = layers.map((l) => Math.max(0, ...l.map((v) => v.w)));
  const colX: number[] = [];
  colW.forEach((_, i) => colX.push(i === 0 ? 0 : colX[i - 1] + colW[i - 1] + COL_GAP));
  for (const l of layers) {
    let y = 0;
    l.forEach((v, i) => {
      if (i > 0) y += gapBetween(l[i - 1], v);
      v.cy = y + v.h / 2;
      y += v.h;
    });
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const place = (l: V[], pick: (v: V) => V[]) => {
    const want = l.map((v) => {
      const nb = pick(v);
      return nb.length ? median(nb.map((n) => n.cy)) : v.cy;
    });
    placeInOrder(l, want);
  };
  for (let r = 0; r < ALIGN_ROUNDS; r++) {
    for (let k = 1; k <= maxLayer; k++) place(layers[k], (v) => v.preds);
    for (let k = maxLayer - 1; k >= 0; k--) place(layers[k], (v) => v.succs);
  }
  for (const l of layers) place(l, (v) => [...v.preds, ...v.succs]);

  // ── 결과 (묶음의 왼쪽 위 = 0, 0)
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (const v of vs.values()) {
    minTop = Math.min(minTop, v.cy - v.h / 2);
    maxBottom = Math.max(maxBottom, v.cy + v.h / 2);
  }
  const pos = new Map<string, Vec>();
  for (const v of vs.values()) {
    if (v.real) pos.set(v.id, { x: colX[v.layer] + (colW[v.layer] - v.w) / 2, y: v.cy - v.h / 2 - minTop });
  }
  // 통로: 지나는 열마다 왼쪽 끝·가운데·오른쪽 끝을 같은 높이로 → 열 안에서는 수평, 휘는 곳은 열 사이 빈 곳뿐.
  // 양 끝 Box가 열보다 좁으면 열 끝까지 수평으로 나간 뒤 휜다.
  const lanes = new Map<string, Vec[]>();
  for (const d of dag) {
    const chain = chains.get(d.edge.id);
    if (!chain) continue;
    const a = vs.get(d.from)!;
    const b = vs.get(d.to)!;
    const pts: Vec[] = [];
    // 짧은 수평 구간은 넣지 않는다 (붙는 자리가 조금만 달라도 Route가 나가는 방향이 크게 흔들림)
    if (colW[a.layer] - a.w >= STUB_MIN * 2) pts.push({ x: colX[a.layer] + colW[a.layer], y: a.cy - minTop });
    for (const v of chain) {
      const y = v.cy - minTop;
      pts.push({ x: colX[v.layer], y }, { x: colX[v.layer] + colW[v.layer] / 2, y }, { x: colX[v.layer] + colW[v.layer], y });
    }
    if (colW[b.layer] - b.w >= STUB_MIN * 2) pts.push({ x: colX[b.layer], y: b.cy - minTop });
    const dedup = pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) > 0.5);
    lanes.set(d.edge.id, back.has(d.edge.id) ? dedup.reverse() : dedup);
  }
  return { pos, lanes, back, width: colX[maxLayer] + colW[maxLayer], height: maxBottom - minTop };
}

const gapBetween = (a: V, b: V) => (a.real && b.real ? ROW_GAP : LANE_GAP);

/**
 * 한 열의 Box들을 순서를 지키며 원하는 높이에 가장 가깝게 놓는다 (서로 겹치지 않게).
 * 간격만큼 미리 밀어 두면 "순서 유지 = 값이 줄지 않음" 문제가 되어, 이웃 평균으로 합치는 방법(PAV)으로 정확히 풀린다.
 */
function placeInOrder(l: V[], want: number[]) {
  if (!l.length) return;
  const offset: number[] = [0];
  for (let i = 1; i < l.length; i++) offset.push(offset[i - 1] + l[i - 1].h / 2 + gapBetween(l[i - 1], l[i]) + l[i].h / 2);
  const blocks: { sum: number; n: number }[] = [];
  for (let i = 0; i < l.length; i++) {
    blocks.push({ sum: want[i] - offset[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  }
  let i = 0;
  for (const b of blocks) {
    const z = b.sum / b.n;
    for (let k = 0; k < b.n; k++, i++) l[i].cy = z + offset[i];
  }
}

/** 이웃한 두 열 사이에서 Route끼리 엇갈리는 수 */
function crossings(layers: V[][]): number {
  let total = 0;
  for (let l = 0; l + 1 < layers.length; l++) {
    const pairs: [number, number][] = [];
    for (const v of layers[l]) for (const s of v.succs) pairs.push([v.pos, s.pos]);
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [a1, b1] = pairs[i];
        const [a2, b2] = pairs[j];
        if ((a1 - a2) * (b1 - b2) < 0) total++;
      }
    }
  }
  return total;
}
