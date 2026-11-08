/**
 * 계획 블록끼리의 순서 그래프.
 *  - Route A → B (둘 다 계획 블록) = "A가 끝나야(완료·건너뜀) B를 시작할 수 있다"
 *  - 생각 Box와 이어진 Route는 참고 관계일 뿐 순서에 넣지 않는다
 *  - "할 수 있음(ready)"·"막힘(blocked)"은 저장하지 않고 여기서 계산한다
 */
import type { BoxNode, Doc, StepInfo, StepStatus } from '../model/types';
import { workflowOf } from './defaults';

export type StepNode = BoxNode & { step: StepInfo };

export const isStep = (n: BoxNode | undefined): n is StepNode => !!n?.step;

export function steps(doc: Doc): StepNode[] {
  return Object.values(doc.nodes).filter(isStep);
}

export interface StepGraph {
  /** 앞 단계들 (이 단계보다 먼저 끝나야 하는 단계) */
  preds: Map<string, string[]>;
  /** 뒤 단계들 */
  succs: Map<string, string[]>;
}

export function stepGraph(doc: Doc): StepGraph {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const s of steps(doc)) {
    preds.set(s.id, []);
    succs.set(s.id, []);
  }
  for (const e of Object.values(doc.edges)) {
    const a = e.sourceNodeId;
    const b = e.targetNodeId;
    if (!preds.has(a) || !preds.has(b)) continue;
    if (!preds.get(b)!.includes(a)) preds.get(b)!.push(a);
    if (!succs.get(a)!.includes(b)) succs.get(a)!.push(b);
  }
  return { preds, succs };
}

/** 보드에서 읽는 순서: 왼쪽 → 오른쪽, 같은 열이면 위 → 아래 */
const byPosition = (doc: Doc) => (a: string, b: string) => {
  const na = doc.nodes[a];
  const nb = doc.nodes[b];
  return na.x - nb.x || na.y - nb.y || (a < b ? -1 : a > b ? 1 : 0);
};

/**
 * 진행 순서 (위상 정렬). 앞 단계가 없는 것부터, 같이 할 수 있는 것끼리는 보드 위치 순서.
 * 순환에 걸린 단계는 순서를 정할 수 없어 cycle에 따로 돌려주고, 순환 뒤에 오는 단계는 order 끝에 붙인다.
 */
export function stepOrder(doc: Doc): { order: string[]; cycle: string[] } {
  const { preds, succs } = stepGraph(doc);
  const cmp = byPosition(doc);
  const left = new Map([...preds].map(([id, p]) => [id, p.length]));
  const queue = [...left].filter(([, n]) => n === 0).map(([id]) => id).sort(cmp);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id)!) {
      const n = left.get(s)! - 1;
      left.set(s, n);
      if (n === 0) {
        queue.push(s);
        queue.sort(cmp);
      }
    }
  }
  // 남은 것 중 순환 뒤에만 있는 단계(뒤 단계가 없어질 때까지 끝에서부터 걷어 냄)와 순환에 걸린 단계를 나눈다
  const rest = new Set([...left.keys()].filter((id) => !order.includes(id)));
  const out = new Map([...rest].map((id) => [id, succs.get(id)!.filter((s) => rest.has(s)).length]));
  const tail: string[] = [];
  const free = [...out].filter(([, n]) => n === 0).map(([id]) => id).sort(cmp).reverse();
  while (free.length) {
    const id = free.shift()!;
    tail.unshift(id);
    for (const p of preds.get(id)!) {
      if (!out.has(p) || tail.includes(p)) continue;
      const n = out.get(p)! - 1;
      out.set(p, n);
      if (n === 0) free.push(p);
    }
  }
  const cycle = [...rest].filter((id) => !tail.includes(id)).sort(cmp);
  return { order: [...order, ...tail], cycle };
}

/** 화면·AI에 보여 주는 상태: 저장된 상태 + 계산한 ready / blocked */
export type EffectiveStatus = StepStatus | 'ready' | 'blocked';

const FINISHED: StepStatus[] = ['done', 'skipped'];
export const isFinished = (s: StepStatus) => FINISHED.includes(s);
/** 진행 중으로 치는 상태 (동시 진행 수에 들어감) */
export const isActive = (s: StepStatus) => s === 'running' || s === 'waiting' || s === 'asking' || s === 'review';

/**
 * 모든 계획 블록의 화면 상태.
 *  - todo이고 앞 단계가 모두 끝났으면 ready
 *  - todo인데 앞쪽 어딘가가 실패했거나 순환에 걸렸으면 blocked (앞 단계가 진행 중일 뿐이면 그대로 todo)
 */
export function effectiveStatuses(doc: Doc): Map<string, EffectiveStatus> {
  const { preds } = stepGraph(doc);
  const { order, cycle } = stepOrder(doc);
  const out = new Map<string, EffectiveStatus>();
  const broken = new Set<string>(cycle);
  for (const id of order) {
    const st = doc.nodes[id].step!.status;
    const ps = preds.get(id)!;
    const upstreamBroken = ps.some((p) => broken.has(p) || doc.nodes[p].step!.status === 'failed');
    if (upstreamBroken && !isFinished(st)) broken.add(id);
    if (st !== 'todo') out.set(id, st);
    else if (upstreamBroken) out.set(id, 'blocked');
    else out.set(id, ps.every((p) => isFinished(doc.nodes[p].step!.status)) ? 'ready' : 'todo');
  }
  for (const id of cycle) {
    const st = doc.nodes[id].step!.status;
    out.set(id, st === 'todo' ? 'blocked' : st);
  }
  return out;
}

/** 앞 단계가 모두 끝났는가 */
export function depsFinished(doc: Doc, id: string): boolean {
  const ps = stepGraph(doc).preds.get(id);
  return !!ps && ps.every((p) => isFinished(doc.nodes[p].step!.status));
}

/**
 * 지금 시작할 수 있는 단계 (진행 순서대로). 동시 진행 수(parallel)를 넘으면 빈 목록.
 * assignee로 거르면 Claude가 맡을 단계 / 사람이 할 단계만.
 */
export function nextSteps(doc: Doc, assignee?: 'claude' | 'human'): string[] {
  const all = steps(doc);
  const active = all.filter((s) => isActive(s.step.status)).length;
  const room = Math.max(1, workflowOf(doc).parallel) - active;
  if (room <= 0) return [];
  const status = effectiveStatuses(doc);
  return stepOrder(doc)
    .order.filter((id) => status.get(id) === 'ready' && (!assignee || doc.nodes[id].step!.assignee === assignee))
    .slice(0, room);
}

export interface Progress {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  active: number;
  /** 끝난 비율 (0~1) — 완료 + 건너뜀 */
  ratio: number;
}

export function progress(doc: Doc): Progress {
  const all = steps(doc).map((s) => s.step.status);
  const count = (f: (s: StepStatus) => boolean) => all.filter(f).length;
  const done = count((s) => s === 'done');
  const skipped = count((s) => s === 'skipped');
  return {
    total: all.length,
    done,
    skipped,
    failed: count((s) => s === 'failed'),
    active: count(isActive),
    ratio: all.length ? (done + skipped) / all.length : 0,
  };
}

/** 32비트 FNV-1a → 16진 8자리 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 계획의 지문: 사람이 쓴 계획 내용(목표, 단계의 제목·메모·할 일·완료 기준·만들 것·참고·담당·승인·검토·도구, 단계 순서)이
 * 바뀌면 달라진다. 진행 상태·결과·기록·위치는 넣지 않는다. 결과가 어떤 계획으로 실행된 것인지 묶는 데 쓴다.
 */
export function planFingerprint(doc: Doc): string {
  const wf = workflowOf(doc);
  const ss = steps(doc)
    .map((s) => {
      const { goal, doneWhen, deliverables, references, assignee, approval, review, resources } = s.step;
      return [s.id, s.text, s.note, goal, doneWhen, deliverables, references, assignee, approval, review, resources];
    })
    .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
  const { preds } = stepGraph(doc);
  const order = [...preds].map(([id, ps]) => [id, [...ps].sort()]).sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
  return fnv1a(JSON.stringify([wf.goal, wf.defaults, ss, order]));
}
