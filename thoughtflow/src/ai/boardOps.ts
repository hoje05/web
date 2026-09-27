/**
 * AI가 보드를 읽고 고치는 순수 함수들.
 * Doc을 받아 새 Doc과 AI에게 돌려줄 설명(text)을 만든다. 저장·화면 처리는 aiBridge.ts가 한다.
 *
 * Box는 id로 가리키고, id 대신 정확한 제목을 써도 (보드에 하나뿐이면) 찾는다.
 */
import { straightSides } from '../anchors/sideSelection';
import { nodeRect, type Rect } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import { addEdge, addNode, removeEdge, removeNode, updateNode } from '../model/docOps';
import { incomingEdges, outgoingEdges } from '../model/graph';
import { newId } from '../model/ids';
import type { BoxNode, Doc, RouteEdge } from '../model/types';
import { estimateBoxSize, placeBoxes, type PlaceRequest } from './layout';
import type { AddFlowArgs, FlowRouteInput } from './protocol';

export const MAX_BOXES_PER_CALL = 60;
export const MAX_TITLE = 300;
export const MAX_NOTE = 20000;

/** 성공하면 doc(바뀐 경우)과 설명, 실패하면 error */
export type OpResult = { ok: true; doc: Doc; text: string; created?: string[] } | { ok: false; error: string };

const fail = (error: string): OpResult => ({ ok: false, error });

// ───────────── 보드 → 글 ─────────────

const oneLine = (s: string, max = 80) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
export const boxLabel = (n: BoxNode) => `${oneLine(n.text) || '(제목 없음)'} [${n.id}]`;
const byPosition = (a: BoxNode, b: BoxNode) => a.y - b.y || a.x - b.x;

export interface DescribeOptions {
  projectName: string;
  includeNotes?: boolean;
  /** 사용자가 지금 보고 있는 Box (오른쪽 창) */
  focusId?: string | null;
  /** 이 글자 수를 넘으면 메모를 빼고 줄인다 */
  maxChars?: number;
}

/**
 * 보드 구조를 AI가 읽기 쉬운 글로.
 * 흐름의 시작(들어오는 Route가 없는 Box)부터 나가는 Route를 따라 들여쓰기로 보여 주고,
 * 이미 나온 Box를 다시 만나면 "(위에 나옴)"으로 표시해 순환·합류를 나타낸다.
 */
export function describeBoard(doc: Doc, opts: DescribeOptions): string {
  const nodes = Object.values(doc.nodes);
  const edges = Object.values(doc.edges);
  const head = [`프로젝트: ${opts.projectName}`, `Box ${nodes.length}개 · Route ${edges.length}개 (→ 는 흐름 방향)`];
  if (opts.focusId && doc.nodes[opts.focusId]) head.push(`사용자가 지금 보고 있는 Box: ${boxLabel(doc.nodes[opts.focusId])}`);
  if (!nodes.length) return [...head, '', '보드가 비어 있습니다.'].join('\n');

  const out = [...head, '', '[흐름]'];
  const seen = new Set<string>();
  const children = (id: string) =>
    outgoingEdges(doc, id)
      .map((e) => doc.nodes[e.targetNodeId])
      .filter(Boolean)
      .sort(byPosition);
  const noteMark = (n: BoxNode) => (n.note.trim() && !opts.includeNotes ? ' (메모 있음)' : '');

  const walk = (n: BoxNode, depth: number) => {
    const indent = '  '.repeat(depth);
    const arrow = depth ? '→ ' : '- ';
    if (seen.has(n.id)) {
      out.push(`${indent}${arrow}${boxLabel(n)} (위에 나옴)`);
      return;
    }
    seen.add(n.id);
    out.push(`${indent}${arrow}${boxLabel(n)}${noteMark(n)}`);
    for (const c of children(n.id)) walk(c, depth + 1);
  };

  const sorted = nodes.slice().sort(byPosition);
  for (const n of sorted) if (incomingEdges(doc, n.id).length === 0) walk(n, 0);
  // 순환 안에만 있는 Box
  for (const n of sorted) if (!seen.has(n.id)) walk(n, 0);

  const withNotes = sorted.filter((n) => n.note.trim());
  if (opts.includeNotes && withNotes.length) {
    const notes = ['', '[메모]'];
    for (const n of withNotes) notes.push(`${boxLabel(n)}`, indentNote(clip(n.note, 1200)), '');
    const full = [...out, ...notes].join('\n').trimEnd();
    if (full.length <= (opts.maxChars ?? 40000)) return full;
    out.push('', `(메모가 있는 Box ${withNotes.length}개 — 보드가 커서 메모는 뺐습니다. read_box로 읽으세요.)`);
  }
  return out.join('\n');
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}… (${s.length - max}자 더 있음 — read_box로 전체 보기)` : s);
const indentNote = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');

// ───────────── Box 찾기 ─────────────

/** id → 정확한 제목(하나뿐일 때) 순서로 찾는다 */
export function resolveBox(doc: Doc, ref: string | undefined | null): BoxNode | { error: string } {
  const r = (ref ?? '').trim();
  if (!r) return { error: 'Box id가 비어 있습니다.' };
  const byId = doc.nodes[r] ?? doc.nodes[r.replace(/^\[|\]$/g, '')];
  if (byId) return byId;
  const t = r.toLowerCase();
  const same = Object.values(doc.nodes).filter((n) => n.text.trim().toLowerCase() === t);
  if (same.length === 1) return same[0];
  if (same.length > 1) return { error: `제목이 '${r}'인 Box가 ${same.length}개 있습니다. id로 가리켜 주세요: ${same.map((n) => n.id).join(', ')}` };
  return { error: `Box를 찾을 수 없습니다: '${r}'. get_board나 search_boxes로 id를 확인하세요.` };
}

const isErr = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && 'error' in v;

export function readBox(doc: Doc, ref: string): OpResult {
  const n = resolveBox(doc, ref);
  if (isErr(n)) return fail(n.error);
  const ins = incomingEdges(doc, n.id).map((e) => doc.nodes[e.sourceNodeId]).filter(Boolean);
  const outs = outgoingEdges(doc, n.id).map((e) => doc.nodes[e.targetNodeId]).filter(Boolean);
  const lines = [
    `Box: ${boxLabel(n)}${n.origin ? ` (${n.origin}가 만듦)` : ''}`,
    `제목 전체: ${n.text || '(없음)'}`,
    `들어오는 흐름: ${ins.length ? ins.map((b) => `← ${boxLabel(b)}`).join(', ') : '없음 (흐름의 시작)'}`,
    `나가는 흐름: ${outs.length ? outs.map((b) => `→ ${boxLabel(b)}`).join(', ') : '없음'}`,
    '메모:',
    n.note.trim() ? indentNote(n.note) : '  (없음)',
  ];
  return { ok: true, doc, text: lines.join('\n') };
}

export function searchBoxes(doc: Doc, query: string): OpResult {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return fail('검색어가 비어 있습니다.');
  const hits = Object.values(doc.nodes)
    .filter((n) => {
      const hay = `${n.text}\n${n.note}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort(byPosition);
  if (!hits.length) return { ok: true, doc, text: `'${query}'가 들어 있는 Box가 없습니다.` };
  const lines = [`'${query}' 검색 결과 ${hits.length}개:`];
  for (const n of hits.slice(0, 50)) {
    lines.push(`- ${boxLabel(n)}`);
    const i = n.note.toLowerCase().indexOf(words[0]);
    if (i >= 0) lines.push(`  메모: …${oneLine(n.note.slice(Math.max(0, i - 40), i + 80), 140)}…`);
  }
  if (hits.length > 50) lines.push(`(그 밖에 ${hits.length - 50}개)`);
  return { ok: true, doc, text: lines.join('\n') };
}

// ───────────── 고치기 ─────────────

/** 두 Box 위치에 맞는 면으로 자동 연결선 */
export function makeAutoEdge(doc: Doc, from: string, to: string): RouteEdge {
  const [s, t] = straightSides(nodeRect(doc.nodes[from]), nodeRect(doc.nodes[to]));
  return {
    id: newId('e'),
    sourceNodeId: from,
    targetNodeId: to,
    sourceAnchor: { side: s },
    targetAnchor: { side: t },
    pathPoints: [],
    pathMode: 'auto',
  };
}

const hasEdge = (doc: Doc, from: string, to: string) =>
  Object.values(doc.edges).some((e) => e.sourceNodeId === from && e.targetNodeId === to);

const cleanTitle = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, MAX_TITLE) : '');
const cleanNote = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, MAX_NOTE) : '');

/**
 * 여러 Box와 Route를 한 번에 추가한다 (사용자에게는 되돌리기 한 번).
 *  - routes를 주지 않으면 boxes 순서대로 한 줄로 잇는다 (after → 1 → 2 → …).
 *  - after를 주면 새 Box 중 들어오는 Route가 없는 Box들을 after 뒤에 잇는다.
 * 하나라도 잘못되면 아무것도 바꾸지 않는다.
 */
export function addFlow(doc: Doc, args: AddFlowArgs, origin: string, center: Vec): OpResult {
  const boxes = Array.isArray(args.boxes) ? args.boxes : [];
  if (!boxes.length) return fail('boxes가 비어 있습니다. 추가할 Box를 하나 이상 주세요.');
  if (boxes.length > MAX_BOXES_PER_CALL) return fail(`한 번에 Box를 ${MAX_BOXES_PER_CALL}개까지 추가할 수 있습니다.`);

  // 새 Box: key → 임시 정보
  const keys: string[] = [];
  const fresh = new Map<string, { id: string; title: string; note: string }>();
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const title = cleanTitle(b?.title);
    if (!title) return fail(`boxes[${i}]의 title이 비어 있습니다.`);
    const key = (typeof b.key === 'string' && b.key.trim()) || `#${i + 1}`;
    if (fresh.has(key)) return fail(`key '${key}'가 두 번 쓰였습니다. key는 서로 달라야 합니다.`);
    if (doc.nodes[key]) return fail(`key '${key}'가 기존 Box id와 같습니다. 다른 key를 쓰세요.`);
    keys.push(key);
    fresh.set(key, { id: newId('n'), title, note: cleanNote(b.note) });
  }

  // 참조 풀기: 새 Box key → 기존 Box id → 기존 Box 제목
  const resolve = (ref: string): string | { error: string } => {
    const r = (ref ?? '').trim();
    if (fresh.has(r)) return r;
    const n = resolveBox(doc, r);
    return isErr(n) ? n : n.id;
  };

  const pairs: [string, string][] = [];
  let routes: FlowRouteInput[];
  if (Array.isArray(args.routes)) {
    routes = args.routes;
  } else {
    routes = keys.slice(1).map((k, i) => ({ from: keys[i], to: k }));
  }
  for (const r of routes) {
    const a = resolve(r?.from);
    if (isErr(a)) return fail(`routes의 from: ${a.error}`);
    const b = resolve(r?.to);
    if (isErr(b)) return fail(`routes의 to: ${b.error}`);
    if (a === b) return fail(`같은 Box끼리는 이을 수 없습니다: '${r.from}'`);
    pairs.push([a, b]);
  }
  if (args.after !== undefined && args.after !== null && String(args.after).trim()) {
    const after = resolveBox(doc, String(args.after));
    if (isErr(after)) return fail(`after: ${after.error}`);
    const hasIncoming = new Set(pairs.map(([, to]) => to));
    for (const k of keys) if (!hasIncoming.has(k)) pairs.push([after.id, k]);
  }

  // 배치
  const existing = new Map<string, Rect>(Object.values(doc.nodes).map((n) => [n.id, nodeRect(n)]));
  const existingChildren = new Map<string, Rect[]>();
  for (const e of Object.values(doc.edges)) {
    const t = doc.nodes[e.targetNodeId];
    if (!t) continue;
    const list = existingChildren.get(e.sourceNodeId) ?? [];
    list.push(nodeRect(t));
    existingChildren.set(e.sourceNodeId, list);
  }
  const requests: PlaceRequest[] = keys.map((k) => ({
    key: k,
    ...estimateBoxSize(fresh.get(k)!.title),
    parents: pairs.filter(([, to]) => to === k).map(([from]) => from),
    children: pairs.filter(([from]) => from === k).map(([, to]) => to),
  }));
  const positions = placeBoxes(existing, requests, center, existingChildren);

  let next = doc;
  const idOf = (ref: string) => fresh.get(ref)?.id ?? ref;
  for (const req of requests) {
    const f = fresh.get(req.key)!;
    const p = positions.get(req.key)!;
    next = addNode(next, {
      id: f.id,
      x: p.x,
      y: p.y,
      width: req.width,
      height: req.height,
      text: f.title,
      note: f.note,
      ...(origin ? { origin } : {}),
    });
  }
  let routeCount = 0;
  const added = new Set<string>();
  for (const [a, b] of pairs) {
    const from = idOf(a);
    const to = idOf(b);
    if (added.has(`${from}>${to}`) || hasEdge(next, from, to)) continue;
    added.add(`${from}>${to}`);
    next = addEdge(next, makeAutoEdge(next, from, to));
    routeCount++;
  }

  const lines = [`Box ${keys.length}개와 Route ${routeCount}개를 추가했습니다.`];
  for (const k of keys) {
    const f = fresh.get(k)!;
    lines.push(`- ${oneLine(f.title)} [${f.id}]${k.startsWith('#') ? '' : ` (key: ${k})`}`);
  }
  return { ok: true, doc: next, text: lines.join('\n'), created: keys.map((k) => fresh.get(k)!.id) };
}

export function updateBox(
  doc: Doc,
  args: { id: string; title?: string; note?: string; append_note?: string },
): OpResult {
  const n = resolveBox(doc, args.id);
  if (isErr(n)) return fail(n.error);
  const patch: Partial<BoxNode> = {};
  if (typeof args.title === 'string') {
    const t = cleanTitle(args.title);
    if (!t) return fail('title을 비울 수 없습니다.');
    patch.text = t;
  }
  if (typeof args.note === 'string') patch.note = cleanNote(args.note);
  if (typeof args.append_note === 'string' && args.append_note.trim()) {
    const base = (patch.note ?? n.note).trimEnd();
    patch.note = `${base}${base ? '\n\n' : ''}${args.append_note.trim()}`.slice(0, MAX_NOTE);
  }
  if (!Object.keys(patch).length) return fail('바꿀 내용(title, note, append_note)이 없습니다.');
  const next = updateNode(doc, n.id, patch);
  const what = patch.note === undefined ? '제목을' : patch.text === undefined ? '메모를' : '제목과 메모를';
  return { ok: true, doc: next, text: `${boxLabel(next.nodes[n.id])}의 ${what} 고쳤습니다.`, created: [] };
}

export function connectBoxes(doc: Doc, from: string, to: string): OpResult {
  const a = resolveBox(doc, from);
  if (isErr(a)) return fail(`from: ${a.error}`);
  const b = resolveBox(doc, to);
  if (isErr(b)) return fail(`to: ${b.error}`);
  if (a.id === b.id) return fail('같은 Box끼리는 이을 수 없습니다.');
  if (hasEdge(doc, a.id, b.id)) return { ok: true, doc, text: `이미 이어져 있습니다: ${boxLabel(a)} → ${boxLabel(b)}` };
  const next = addEdge(doc, makeAutoEdge(doc, a.id, b.id));
  return { ok: true, doc: next, text: `이었습니다: ${boxLabel(a)} → ${boxLabel(b)}`, created: [] };
}

export function deleteItems(doc: Doc, args: { box_ids?: string[]; routes?: FlowRouteInput[] }): OpResult {
  const boxIds = Array.isArray(args.box_ids) ? args.box_ids : [];
  const routes = Array.isArray(args.routes) ? args.routes : [];
  if (!boxIds.length && !routes.length) return fail('지울 Box(box_ids)나 Route(routes)를 주세요.');
  let next = doc;
  const removed: string[] = [];
  let routeCount = 0;
  for (const r of routes) {
    const a = resolveBox(doc, r?.from);
    if (isErr(a)) return fail(`routes의 from: ${a.error}`);
    const b = resolveBox(doc, r?.to);
    if (isErr(b)) return fail(`routes의 to: ${b.error}`);
    const edge = Object.values(next.edges).find((e) => e.sourceNodeId === a.id && e.targetNodeId === b.id);
    if (!edge) return fail(`${boxLabel(a)} → ${boxLabel(b)} Route가 없습니다.`);
    next = removeEdge(next, edge.id);
    routeCount++;
  }
  for (const ref of boxIds) {
    const n = resolveBox(doc, ref);
    if (isErr(n)) return fail(n.error);
    if (!next.nodes[n.id]) continue;
    routeCount += Object.values(next.edges).filter((e) => e.sourceNodeId === n.id || e.targetNodeId === n.id).length;
    next = removeNode(next, n.id);
    removed.push(boxLabel(n));
  }
  const parts = [removed.length && `Box ${removed.length}개`, routeCount && `Route ${routeCount}개`].filter(Boolean).join('와 ');
  const lines = [`${parts}를 지웠습니다. (사용자는 ThoughtFlow에서 Ctrl+Z로 되돌릴 수 있습니다)`, ...removed.map((l) => `- ${l}`)];
  return { ok: true, doc: next, text: lines.join('\n'), created: [] };
}
