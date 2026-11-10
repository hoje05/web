/**
 * 계획 블록의 상태 바꾸기 규칙 — "사람이 설계한 계획대로" 진행되도록 지키는 곳.
 *
 *  - 계획 내용(할 일·완료 기준·만들 것·참고·담당·승인·검토·도구)은 사람만 고친다. 계획이 잠겨 있으면 사람도 먼저 풀어야 한다.
 *  - AI(by ≠ HUMAN)는 상태·결과·질문·수정 제안만 적는다. 보드 설정이 "읽기만"이면 그것도 못 한다.
 *  - 시작: 앞 단계가 모두 끝나고, 동시 진행 수 안이고, Claude가 맡은 단계이고, 승인이 필요하면 승인을 받았을 때만.
 *  - 완료: 만들 것마다 만든 위치, 완료 기준마다 통과와 근거, 실제로 쓴 도구를 모두 보고해야 한다. 하나라도 빠지거나 실패면 거부.
 *  - 계획에 없는 결정은 질문(asking), 계획이 틀려 보이면 수정 제안 — 스스로 바꾸지 않는다.
 *
 * 모두 순수 함수: 새 Doc을 돌려주거나(ok) 왜 안 되는지 알려 준다(error). Undo는 부르는 쪽이 한 칸으로 묶는다.
 */
import { updateNode } from '../model/docOps';
import type { Deliverable, Doc, StepInfo, StepResources, StepResult, StepStatus, WorkflowMeta } from '../model/types';
import { newStep, workflowOf } from './defaults';
import { depsFinished, isActive, isStep, planFingerprint, steps } from './graph';
import { normalizeResources } from './resources';

/** 사람이 한 일의 by 값 */
export const HUMAN = '사람';

export type Outcome = { ok: true; doc: Doc } | { ok: false; error: string };

const ok = (doc: Doc): Outcome => ({ ok: true, doc });
const fail = (error: string): Outcome => ({ ok: false, error });
const nowIso = () => new Date().toISOString();
const newId = (): string => globalThis.crypto.randomUUID();
const MAX_LOG = 200;

const STATUS_NAME: Record<StepStatus, string> = {
  todo: '할 일',
  running: '진행 중',
  waiting: '승인 대기',
  asking: '질문 중',
  review: '검토 대기',
  done: '완료',
  failed: '실패',
  skipped: '건너뜀',
};
export const statusName = (s: StepStatus) => STATUS_NAME[s];

function stepOf(doc: Doc, id: string): StepInfo | string {
  const node = doc.nodes[id];
  if (!node) return '그런 Box가 없습니다.';
  if (!isStep(node)) return `'${node.text || '(제목 없음)'}'은(는) 계획 블록이 아닙니다.`;
  return node.step;
}

/** AI가 상태를 적을 수 있는가 */
function aiCheck(doc: Doc, by: string): string | null {
  if (by === HUMAN) return null;
  return workflowOf(doc).stepPermission === 'read' ? '이 계획은 AI가 읽기만 하도록 설정되어 있습니다. (계획 창의 AI 권한)' : null;
}

function withStep(doc: Doc, id: string, step: StepInfo): Doc {
  return updateNode(doc, id, { step });
}

/** 상태를 바꾸고 기록 한 줄을 남긴다 */
function transition(step: StepInfo, status: StepStatus, by: string, at: string, note?: string, extra: Partial<StepInfo> = {}): StepInfo {
  const log = [...step.log, { at, by, status, ...(note ? { note } : {}) }].slice(-MAX_LOG);
  return { ...step, ...extra, status, log };
}

// ───────────── 사람: 계획 쓰기 ─────────────

/** Box를 계획 블록으로 만들기 / 풀기 (풀면 진행 기록도 사라진다 — Undo로 되돌릴 수 있음) */
export function setStepEnabled(doc: Doc, id: string, on: boolean): Outcome {
  const node = doc.nodes[id];
  if (!node) return fail('그런 Box가 없습니다.');
  if (workflowOf(doc).locked) return fail('계획이 잠겨 있습니다. 계획 창에서 잠금을 푼 뒤 바꿔 주세요.');
  if (on === !!node.step) return ok(doc);
  if (on) return ok(updateNode(doc, id, { step: newStep() }));
  const next = { ...node };
  delete next.step;
  return ok({ ...doc, nodes: { ...doc.nodes, [id]: next } });
}

export type StepPlanPatch = Partial<
  Pick<StepInfo, 'goal' | 'doneWhen' | 'deliverables' | 'references' | 'assignee' | 'approval' | 'review' | 'resources'>
>;

const cleanLines = (list: unknown, max = 50, len = 2000): string[] =>
  Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim().slice(0, len)).slice(0, max) : [];

export function cleanDeliverables(list: unknown): Deliverable[] {
  if (!Array.isArray(list)) return [];
  const out: Deliverable[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const spec = typeof r.spec === 'string' ? r.spec.trim().slice(0, 2000) : '';
    const path = typeof r.path === 'string' ? r.path.trim().slice(0, 500) : '';
    if (!spec && !path) continue;
    out.push(path ? { path, spec } : { spec });
  }
  return out.slice(0, 50);
}

/** 계획 블록의 계획 내용 고치기 (사람만) */
export function editStepPlan(doc: Doc, id: string, patch: StepPlanPatch): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  if (workflowOf(doc).locked) return fail('계획이 잠겨 있습니다. 계획 창에서 잠금을 푼 뒤 바꿔 주세요.');
  const next: StepInfo = { ...step };
  if (patch.goal !== undefined) next.goal = String(patch.goal).trim().slice(0, 2000);
  if (patch.doneWhen !== undefined) next.doneWhen = cleanLines(patch.doneWhen);
  if (patch.deliverables !== undefined) next.deliverables = cleanDeliverables(patch.deliverables);
  if (patch.references !== undefined) next.references = cleanLines(patch.references, 50, 1000);
  if (patch.assignee === 'claude' || patch.assignee === 'human') next.assignee = patch.assignee;
  if (patch.approval === 'auto' || patch.approval === 'ask') {
    next.approval = patch.approval;
    if (patch.approval === 'auto') delete next.approved;
  }
  if (patch.review !== undefined) next.review = !!patch.review;
  if (patch.resources !== undefined) next.resources = normalizeResources(patch.resources);
  return ok(withStep(doc, id, next));
}

export type WorkflowPatch = Partial<Pick<WorkflowMeta, 'goal' | 'workingDir' | 'defaults' | 'stepPermission' | 'locked' | 'parallel'>>;

/** 계획 전체 설정 고치기 (사람만). 잠겨 있으면 목표·기본 도구는 잠금을 풀어야 바꿀 수 있다. */
export function editWorkflow(doc: Doc, patch: WorkflowPatch): Outcome {
  const cur = workflowOf(doc);
  const unlocking = patch.locked === false;
  if (cur.locked && !unlocking && (patch.goal !== undefined || patch.defaults !== undefined || patch.workingDir !== undefined)) {
    return fail('계획이 잠겨 있습니다. 잠금을 푼 뒤 바꿔 주세요.');
  }
  const next: WorkflowMeta = { ...cur };
  if (patch.goal !== undefined) next.goal = String(patch.goal).trim().slice(0, 4000);
  if (patch.workingDir !== undefined) {
    const dir = String(patch.workingDir ?? '').trim().slice(0, 1000);
    if (dir) next.workingDir = dir;
    else delete next.workingDir;
  }
  if (patch.defaults !== undefined) next.defaults = normalizeResources(patch.defaults);
  if (patch.stepPermission === 'read' || patch.stepPermission === 'status') next.stepPermission = patch.stepPermission;
  if (patch.locked !== undefined) next.locked = !!patch.locked;
  if (patch.parallel !== undefined) next.parallel = Math.min(8, Math.max(1, Math.round(Number(patch.parallel) || 1)));
  return ok({ ...doc, workflow: next });
}

/** 사람이 상태를 직접 바꾸기 (다시 하기, 건너뛰기, 직접 완료 표시 등). 승인은 approveStep으로. */
export function setStatusByHuman(doc: Doc, id: string, status: StepStatus, note?: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  if (step.status === status) return ok(doc);
  const extra: Partial<StepInfo> = status === 'todo' ? { approved: false } : {};
  return ok(withStep(doc, id, transition(step, status, HUMAN, at, note, extra)));
}

/** 승인 (승인이 필요한 단계를 시작할 수 있게) */
export function approveStep(doc: Doc, id: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  if (step.status !== 'todo' && step.status !== 'waiting') return fail(`지금은 승인할 수 없습니다 (${statusName(step.status)}).`);
  return ok(withStep(doc, id, transition(step, 'todo', HUMAN, at, '승인', { approved: true })));
}

/** 검토 통과 → 완료 */
export function acceptReview(doc: Doc, id: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  if (step.status !== 'review') return fail('검토 대기 중인 단계가 아닙니다.');
  return ok(withStep(doc, id, transition(step, 'done', HUMAN, at, '검토 통과', { approved: false })));
}

/** 검토에서 되돌려 보내기 → 다시 할 일 (이유는 기록과 다음 지시에 남는다) */
export function sendBack(doc: Doc, id: string, reason: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  if (step.status !== 'review' && step.status !== 'done' && step.status !== 'failed') return fail('끝난 단계만 되돌려 보낼 수 있습니다.');
  const note = `다시 하기: ${reason.trim() || '(이유 없음)'}`;
  return ok(withStep(doc, id, transition(step, 'todo', HUMAN, at, note)));
}

/** Claude의 질문에 답하기 → 다시 진행 중 */
export function answerQuestion(doc: Doc, id: string, questionId: string, answer: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const q = step.questions.find((x) => x.id === questionId);
  if (!q) return fail('그런 질문이 없습니다.');
  if (!answer.trim()) return fail('답을 적어 주세요.');
  const questions = step.questions.map((x) => (x.id === questionId ? { ...x, answer: answer.trim().slice(0, 4000), answeredAt: at } : x));
  const stillOpen = questions.some((x) => !x.answer);
  const next = step.status === 'asking' && !stillOpen ? transition(step, 'running', HUMAN, at, '질문에 답함', { questions }) : { ...step, questions };
  return ok(withStep(doc, id, next));
}

/** Claude의 수정 제안 받아들이기 / 거절 — 받아들여도 계획 자체는 사람이 고친다 (기록만 남김) */
export function resolveProposal(doc: Doc, proposalId: string, accepted: boolean): Outcome {
  const wf = workflowOf(doc);
  const p = wf.proposals.find((x) => x.id === proposalId);
  if (!p) return fail('그런 제안이 없습니다.');
  if (p.state !== 'open') return ok(doc);
  const proposals = wf.proposals.map((x) => (x.id === proposalId ? { ...x, state: accepted ? ('accepted' as const) : ('rejected' as const) } : x));
  return ok({ ...doc, workflow: { ...wf, proposals } });
}

// ───────────── AI(또는 사람): 진행 ─────────────

/** 단계 시작 */
export function startStep(doc: Doc, id: string, by: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (step.status === 'running') return ok(doc);
  if (step.status !== 'todo') return fail(`'${doc.nodes[id].text}'은(는) 지금 시작할 수 없습니다 (${statusName(step.status)}).`);
  if (by !== HUMAN && step.assignee === 'human') return fail(`'${doc.nodes[id].text}'은(는) 사람이 하는 단계입니다. 사용자가 끝낼 때까지 기다려 주세요.`);
  if (!depsFinished(doc, id)) return fail(`앞 단계가 아직 끝나지 않았습니다. 순서대로 진행해 주세요.`);
  const parallel = Math.max(1, workflowOf(doc).parallel);
  const active = steps(doc).filter((s) => isActive(s.step.status)).length;
  if (active >= parallel) return fail(`이미 진행 중인 단계가 있습니다. 동시에 ${parallel}개까지만 진행합니다.`);
  if (step.approval === 'ask' && !step.approved) return fail('시작 전에 사용자의 승인이 필요한 단계입니다. 승인을 요청하고(request_approval) 기다려 주세요.');
  return ok(withStep(doc, id, transition(step, 'running', by, at)));
}

/** 승인 요청 → 승인 대기 */
export function requestApproval(doc: Doc, id: string, by: string, why: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (step.status === 'waiting') return ok(doc);
  if (step.status !== 'todo') return fail(`지금은 승인을 요청할 수 없습니다 (${statusName(step.status)}).`);
  if (step.approved) return fail('이미 승인되었습니다. 바로 시작하세요.');
  return ok(withStep(doc, id, transition(step, 'waiting', by, at, why.trim().slice(0, 1000) || undefined)));
}

/** 진행 중 메모 한 줄 */
export function logStep(doc: Doc, id: string, by: string, note: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (!note.trim()) return fail('남길 내용이 없습니다.');
  if (step.status !== 'running') return fail('진행 중인 단계에만 기록할 수 있습니다.');
  return ok(withStep(doc, id, transition(step, 'running', by, at, note.trim().slice(0, 2000))));
}

/** 계획에 없는 결정이 필요할 때 질문 → 질문 중 (사용자가 답하면 다시 진행 중) */
export function askUser(doc: Doc, id: string, by: string, question: string, at = nowIso(), questionId = newId()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (!question.trim()) return fail('질문이 비어 있습니다.');
  if (step.status !== 'running' && step.status !== 'asking') return fail('진행 중인 단계에서만 질문할 수 있습니다.');
  const questions = [...step.questions, { id: questionId, at, by, question: question.trim().slice(0, 4000) }].slice(-50);
  return ok(withStep(doc, id, transition(step, 'asking', by, at, '질문', { questions })));
}

/** 실패 → 뒤 단계는 막힘 */
export function failStep(doc: Doc, id: string, by: string, reason: string, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (!reason.trim()) return fail('실패한 이유를 적어 주세요.');
  if (step.status !== 'running' && step.status !== 'asking' && step.status !== 'waiting') return fail(`지금은 실패로 바꿀 수 없습니다 (${statusName(step.status)}).`);
  return ok(withStep(doc, id, transition(step, 'failed', by, at, reason.trim().slice(0, 2000), { approved: false })));
}

export interface FinishReport {
  summary: string;
  outputs: { deliverable: number; path: string }[];
  criteria: { item: number; pass: boolean; evidence: string }[];
  used: StepResources;
}

/**
 * 완료 보고. 계획과 맞는지 검사한다:
 *  - 만들 것 각 항목(1번부터)에 만든 위치가 있어야 한다
 *  - 완료 기준 각 항목(1번부터)에 통과와 근거가 있어야 하고, 하나라도 실패면 완료가 아니다 (fail_step 또는 계속 작업)
 *  - 실제로 쓴 도구를 함께 보고한다 (지정과 다르면 화면에 ⚠ — 완료는 막지 않는다)
 * 통과하면 검토가 켜진 단계는 검토 대기, 아니면 완료.
 */
export function finishStep(doc: Doc, id: string, by: string, report: FinishReport, at = nowIso()): Outcome {
  const step = stepOf(doc, id);
  if (typeof step === 'string') return fail(step);
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (step.status !== 'running') return fail(`진행 중인 단계만 끝낼 수 있습니다 (지금: ${statusName(step.status)}).`);
  const problems: string[] = [];
  const outputs = (Array.isArray(report.outputs) ? report.outputs : []).filter(
    (o) => o && Number.isInteger(o.deliverable) && typeof o.path === 'string' && o.path.trim(),
  );
  step.deliverables.forEach((d, i) => {
    if (!outputs.some((o) => o.deliverable === i + 1)) problems.push(`만들 것 ${i + 1}번(${d.path ?? d.spec.slice(0, 40)})을 어디에 만들었는지 보고되지 않았습니다.`);
  });
  const criteria = (Array.isArray(report.criteria) ? report.criteria : []).filter((c) => c && Number.isInteger(c.item) && typeof c.pass === 'boolean');
  step.doneWhen.forEach((w, i) => {
    const c = criteria.find((x) => x.item === i + 1);
    if (!c) problems.push(`완료 기준 ${i + 1}번("${w.slice(0, 60)}")의 확인 결과가 없습니다.`);
    else if (!c.pass) problems.push(`완료 기준 ${i + 1}번("${w.slice(0, 60)}")을 통과하지 못했습니다.`);
    else if (!String(c.evidence ?? '').trim()) problems.push(`완료 기준 ${i + 1}번의 근거가 비어 있습니다.`);
  });
  if (!report.used || typeof report.used !== 'object') problems.push('이 단계에서 실제로 쓴 도구(used)를 보고해 주세요 (쓴 것이 없으면 빈 목록).');
  if (problems.length) return fail(`아직 완료할 수 없습니다:\n- ${problems.join('\n- ')}`);
  const result: StepResult = {
    summary: String(report.summary ?? '').trim().slice(0, 4000),
    outputs: outputs.map((o) => ({ deliverable: o.deliverable, path: o.path.trim().slice(0, 500) })),
    criteria: criteria.map((c) => ({ item: c.item, pass: c.pass, evidence: String(c.evidence ?? '').trim().slice(0, 2000) })),
    used: normalizeResources(report.used),
    planVersion: planFingerprint(doc),
    at,
    by,
  };
  const status: StepStatus = step.review ? 'review' : 'done';
  return ok(withStep(doc, id, transition(step, status, by, at, result.summary.slice(0, 200) || undefined, { result, approved: false })));
}

/** 계획 수정 제안 (계획은 바뀌지 않고 제안 목록에만) */
export function proposeChange(
  doc: Doc,
  by: string,
  p: { stepId?: string; change: string; why: string },
  at = nowIso(),
  proposalId = newId(),
): Outcome {
  const denied = aiCheck(doc, by);
  if (denied) return fail(denied);
  if (!p.change?.trim()) return fail('무엇을 바꾸자는지 적어 주세요.');
  if (p.stepId && typeof stepOf(doc, p.stepId) === 'string') return fail('그런 계획 블록이 없습니다.');
  const wf = workflowOf(doc);
  const proposal = {
    id: proposalId,
    at,
    by,
    ...(p.stepId ? { stepId: p.stepId } : {}),
    change: p.change.trim().slice(0, 4000),
    why: (p.why ?? '').trim().slice(0, 2000),
    state: 'open' as const,
  };
  return ok({ ...doc, workflow: { ...wf, proposals: [...wf.proposals, proposal].slice(-100) } });
}
