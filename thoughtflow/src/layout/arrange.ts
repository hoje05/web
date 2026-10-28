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
 *
 * 두 가지 방식 (정렬 버튼을 누를 때마다 번갈아):
 *  - out (나가는 흐름, 기본): 시작 Box에서 앞으로. Box는 "앞 Box 바로 다음 열"에 (가장 이른 열).
 *    선택한 Box가 있으면 그 Box에서 나가는 흐름을 기준으로 (그 Box부터 열을 센다).
 *  - in (들어오는 흐름 중심): 중심 Box에서 Route를 거꾸로 따라가며, 중심으로 모여드는 모양으로.
 *    Box는 "뒤 Box 바로 앞 열"에 (가장 늦은 열) → 중심으로 들어오는 갈래들이 중심 바로 앞에서 모인다.
 *    중심 = 선택한 Box, 없으면 묶음마다 흐름의 끝 Box(나가는 Route가 없는 Box) 중 가장 많은 흐름이 모이는 Box.
 * 어느 방식이든 Box 위치와 Route 모양만 바꾼다 (Route의 방향·연결, 글, 태그, 첨부는 그대로). 순환이 있어도 안전하다.
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

/** out = 나가는 흐름 순서대로 (기존 정렬), in = 들어오는 흐름 중심 */
export type ArrangeMode = 'out' | 'in';

export interface ArrangeOptions {
  mode?: ArrangeMode;
  /** 중심 Box (선택한 Box). 그 Box가 있는 묶음만 이 Box를 기준으로 한다. */
  center?: string | null;
}

export function arrangeDoc(doc: Doc, opts: ArrangeOptions = {}): Doc {
  // 정렬한 모양을 기준으로 다시 정렬해도 같아질 때까지 (몇 번이면 멈춘다) → 정렬 버튼을 다시 눌러도 흔들리지 않는다
  let prev = doc;
  let next = arrangeOnce(doc, opts);
  for (let i = 0; i < 6 && next !== prev; i++) {
    prev = next;
    next = arrangeOnce(prev, opts);
  }
  return next;
}

function arrangeOnce(doc: Doc, opts: ArrangeOptions): Doc {
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
      opts.mode ?? 'out',
      opts.center && ids.has(opts.center) ? opts.center : null,
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
    const anchors = computeAnchors({ ...doc, nodes: nextNodes, edges: planned });
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
  return changed ? { ...doc, nodes: nextNodes, edges: nextEdges } : doc;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

function layoutGroup(
  group: BoxNode[],
  gEdges: RouteEdge[],
  nowAnchors: Map<string, { source: Vec; target: Vec }>,
  mode: ArrangeMode,
  center: string | null,
): GroupLayout {
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
  //    (들어오는 흐름 방식은 중심 Box에서 Route를 거꾸로 훑는다 → 중심으로 들어오는 Route는 되돌아감이 되지 않는다)
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const incoming = new Map<string, RouteEdge[]>(group.map((n) => [n.id, []]));
  for (const e of gEdges) incoming.get(e.targetNodeId)!.push(e);
  // 거꾸로 훑을 때는 나가는 흐름의 거울: 가장 오른쪽(가까운) 앞 Box부터
  for (const list of incoming.values()) list.sort((a, b) => before(byId.get(b.sourceNodeId)!, byId.get(a.sourceNodeId)!));
  const focus = mode === 'in' ? (center ?? primarySink(group, gEdges, outgoing)) : center;
  let starts: BoxNode[];
  if (mode === 'out') starts = [...group].sort((a, b) => Number(indeg.get(a.id)! > 0) - Number(indeg.get(b.id)! > 0) || before(a, b));
  else starts = [...group].sort((a, b) => Number(outgoing.get(a.id)!.length > 0) - Number(outgoing.get(b.id)!.length > 0) || before(b, a));
  if (focus) starts = [byId.get(focus)!, ...starts.filter((n) => n.id !== focus)];
  // out: Route 방향대로 (다음 Box = target), in: 거꾸로 (다음 Box = source)
  const walk = mode === 'out' ? outgoing : incoming;
  const nextOf = (e: RouteEdge) => (mode === 'out' ? e.targetNodeId : e.sourceNodeId);
  for (const s of starts) {
    if (state.has(s.id)) continue;
    state.set(s.id, 1);
    const stack: { id: string; i: number }[] = [{ id: s.id, i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = walk.get(top.id)!;
      if (top.i < list.length) {
        const e = list[top.i++];
        const st = state.get(nextOf(e));
        if (st === 1) back.add(e.id);
        else if (st === undefined) {
          state.set(nextOf(e), 1);
          stack.push({ id: nextOf(e), i: 0 });
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
  let layer = new Map<string, number>();
  if (focus) layer = anchoredLayers(order, ins, outs, focus, mode);
  else {
    for (const id of order) layer.set(id, Math.max(0, ...ins.get(id)!.map((p) => layer.get(p)! + 1)));
    // 시작 Box는 뒤 Box 바로 앞 열로 당긴다 (긴 Route 줄이기)
    for (const id of [...order].reverse()) {
      if (ins.get(id)!.length === 0 && outs.get(id)!.length) layer.set(id, Math.min(...outs.get(id)!.map((t) => layer.get(t)!)) - 1);
    }
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
    // 들어오는 흐름 방식은 중심(오른쪽)에서 거슬러 올라가는 쪽부터
    const down = mode === 'in' ? it % 2 === 1 : it % 2 === 0;
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
    if (mode === 'in') {
      // 들어오는 흐름: 앞 Box들을 뒤 Box 쪽으로 먼저 모은다
      for (let k = maxLayer - 1; k >= 0; k--) place(layers[k], (v) => v.succs);
      for (let k = 1; k <= maxLayer; k++) place(layers[k], (v) => v.preds);
    } else {
      for (let k = 1; k <= maxLayer; k++) place(layers[k], (v) => v.preds);
      for (let k = maxLayer - 1; k >= 0; k--) place(layers[k], (v) => v.succs);
    }
  }
  for (const l of layers) place(l, (v) => [...v.preds, ...v.succs]);
  // 들어오는 흐름: 마지막으로 앞 Box들을 뒤 Box 높이에 맞춘다 (E → B → C가 한 줄로 이어져 중심으로 모이게)
  if (mode === 'in') for (let k = maxLayer - 1; k >= 0; k--) place(layers[k], (v) => v.succs);

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

/**
 * 들어오는 흐름 방식에서 묶음의 중심: 나가는 Route가 없는 Box(흐름의 끝) 중 거슬러 올라가 닿는 Box가 가장 많은 Box.
 * 흐름의 끝이 없으면(모두 순환) 모든 Box 중에서. 같으면 들어오는 Route가 많은 Box → 나중에 만든 Box(id).
 * (위치로 고르지 않는다 → 정렬한 뒤 다시 눌러도 같은 Box가 중심)
 */
function primarySink(group: BoxNode[], gEdges: RouteEdge[], outgoing: Map<string, RouteEdge[]>): string {
  const preds = new Map<string, string[]>(group.map((n) => [n.id, []]));
  for (const e of gEdges) preds.get(e.targetNodeId)!.push(e.sourceNodeId);
  const sinks = group.filter((n) => outgoing.get(n.id)!.length === 0);
  const candidates = sinks.length ? sinks : group;
  const reach = (id: string) => {
    const seen = new Set([id]);
    const stack = [id];
    while (stack.length) for (const p of preds.get(stack.pop()!)!) if (!seen.has(p)) seen.add(p), stack.push(p);
    return seen.size;
  };
  if (candidates.length === 1) return candidates[0].id;
  const score = new Map(candidates.map((n) => [n.id, [reach(n.id), preds.get(n.id)!.length] as const]));
  const better = (a: string, b: string) => {
    const [ra, da] = score.get(a)!;
    const [rb, db] = score.get(b)!;
    return ra !== rb ? ra > rb : da !== db ? da > db : a > b;
  };
  return candidates.map((n) => n.id).reduce((best, id) => (better(id, best) ? id : best));
}

/**
 * 중심 Box를 기준으로 열을 정한다.
 *  - in: 중심으로 들어오는 Box들 = 중심까지 가장 긴 길만큼 앞 열 (모여드는 모양)
 *  - out: 중심에서 나가는 Box들 = 중심에서 가장 긴 길만큼 뒤 열
 * 나머지 Box는 이미 정한 Box에서 가까운 것부터, 이웃한 Box 바로 옆 열에 (in이면 뒤 Box 쪽, out이면 앞 Box 쪽을 먼저).
 * 모든 Route는 앞 열 → 뒤 열을 지킨다 (모자라면 그 뒤를 밀어낸다). 순환은 이미 끊겨 있다 (order = 위상 순서).
 */
function anchoredLayers(
  order: string[],
  ins: Map<string, string[]>,
  outs: Map<string, string[]>,
  focus: string,
  mode: ArrangeMode,
): Map<string, number> {
  const layer = new Map<string, number>([[focus, 0]]);
  if (mode === 'in') {
    for (const id of [...order].reverse()) {
      if (id === focus) continue;
      let best = Infinity;
      for (const t of outs.get(id)!) if (layer.has(t)) best = Math.min(best, layer.get(t)! - 1);
      if (best < Infinity) layer.set(id, best);
    }
  } else {
    for (const id of order) {
      if (id === focus) continue;
      let best = -Infinity;
      for (const p of ins.get(id)!) if (layer.has(p)) best = Math.max(best, layer.get(p)! + 1);
      if (best > -Infinity) layer.set(id, best);
    }
  }
  const push = (start: string, dir: 1 | -1) => {
    const stack = [start];
    while (stack.length) {
      const x = stack.pop()!;
      for (const y of (dir === 1 ? outs : ins).get(x)!) {
        if (!layer.has(y)) continue;
        const need = layer.get(x)! + dir;
        if (dir === 1 ? layer.get(y)! < need : layer.get(y)! > need) {
          layer.set(y, need);
          stack.push(y);
        }
      }
    }
  };
  const queue = order.filter((id) => layer.has(id));
  const queued = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (!layer.has(id)) {
      let lo = -Infinity;
      let hi = Infinity;
      for (const p of ins.get(id)!) if (layer.has(p)) lo = Math.max(lo, layer.get(p)! + 1);
      for (const t of outs.get(id)!) if (layer.has(t)) hi = Math.min(hi, layer.get(t)! - 1);
      if (lo <= hi) layer.set(id, mode === 'in' ? (hi < Infinity ? hi : lo) : lo > -Infinity ? lo : hi);
      else if (mode === 'in') {
        layer.set(id, lo);
        push(id, 1);
      } else {
        layer.set(id, hi);
        push(id, -1);
      }
    }
    for (const nb of [...outs.get(id)!, ...ins.get(id)!]) {
      if (!queued.has(nb)) {
        queued.add(nb);
        queue.push(nb);
      }
    }
  }
  return layer;
}
