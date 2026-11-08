/**
 * 파일(.tflow v4)의 계획 데이터 읽기. 쓰기는 StepInfo·WorkflowMeta가 그대로 JSON이라 그대로 넣는다.
 * 손으로 고친 파일·다른 버전에서 온 값도 안전하게: 모르는 상태는 할 일로, 잘못된 항목은 건너뛴다.
 */
import type { ChangeProposal, StepInfo, StepLogEntry, StepQuestion, StepResult, StepStatus, WorkflowMeta } from '../model/types';
import { DEFAULT_WORKFLOW, newStep } from './defaults';
import { normalizeResources } from './resources';
import { cleanDeliverables } from './transitions';

const STATUSES: StepStatus[] = ['todo', 'running', 'waiting', 'asking', 'review', 'done', 'failed', 'skipped'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const lines = (v: unknown, max = 50, len = 2000) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.slice(0, len)).slice(0, max) : [];
const status = (v: unknown): StepStatus => (STATUSES.includes(v as StepStatus) ? (v as StepStatus) : 'todo');

function parseResult(raw: unknown): StepResult | undefined {
  if (!isObj(raw)) return undefined;
  const outputs = Array.isArray(raw.outputs)
    ? raw.outputs.filter((o): o is { deliverable: number; path: string } => isObj(o) && Number.isInteger(o.deliverable) && typeof o.path === 'string')
    : [];
  const criteria = Array.isArray(raw.criteria)
    ? raw.criteria
        .filter((c): c is Record<string, unknown> => isObj(c) && Number.isInteger(c.item) && typeof c.pass === 'boolean')
        .map((c) => ({ item: c.item as number, pass: c.pass as boolean, evidence: str(c.evidence, 2000) }))
    : [];
  return {
    summary: str(raw.summary, 4000),
    outputs: outputs.map((o) => ({ deliverable: o.deliverable, path: o.path.slice(0, 500) })),
    criteria,
    used: normalizeResources(raw.used),
    planVersion: str(raw.planVersion, 40),
    at: str(raw.at, 40),
    by: str(raw.by, 40),
  };
}

function parseLog(raw: unknown): StepLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((e) => ({ at: str(e.at, 40), by: str(e.by, 40), status: status(e.status), ...(typeof e.note === 'string' && e.note ? { note: e.note.slice(0, 2000) } : {}) }))
    .slice(-200);
}

function parseQuestions(raw: unknown): StepQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => isObj(q) && typeof q.id === 'string' && typeof q.question === 'string')
    .map((q) => ({
      id: q.id as string,
      at: str(q.at, 40),
      by: str(q.by, 40),
      question: (q.question as string).slice(0, 4000),
      ...(typeof q.answer === 'string' && q.answer ? { answer: q.answer.slice(0, 4000), answeredAt: str(q.answeredAt, 40) } : {}),
    }))
    .slice(-50);
}

/** 파일의 step 값 → StepInfo (없거나 객체가 아니면 undefined = 그냥 생각 Box) */
export function parseStep(raw: unknown): StepInfo | undefined {
  if (!isObj(raw)) return undefined;
  const step: StepInfo = {
    ...newStep(str(raw.goal, 2000)),
    status: status(raw.status),
    doneWhen: lines(raw.doneWhen),
    deliverables: cleanDeliverables(raw.deliverables),
    references: lines(raw.references, 50, 1000),
    assignee: raw.assignee === 'human' ? 'human' : 'claude',
    approval: raw.approval === 'ask' ? 'ask' : 'auto',
    review: raw.review === true,
    resources: normalizeResources(raw.resources),
    questions: parseQuestions(raw.questions),
    log: parseLog(raw.log),
  };
  if (raw.approved === true && step.approval === 'ask') step.approved = true;
  const result = parseResult(raw.result);
  if (result) step.result = result;
  return step;
}

function parseProposals(raw: unknown): ChangeProposal[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => isObj(p) && typeof p.id === 'string' && typeof p.change === 'string')
    .map((p) => ({
      id: p.id as string,
      at: str(p.at, 40),
      by: str(p.by, 40),
      ...(typeof p.stepId === 'string' && p.stepId ? { stepId: p.stepId } : {}),
      change: (p.change as string).slice(0, 4000),
      why: str(p.why, 2000),
      state: p.state === 'accepted' || p.state === 'rejected' ? (p.state as ChangeProposal['state']) : 'open',
    }))
    .slice(-100);
}

/** 파일의 workflow 값 → WorkflowMeta (없으면 undefined = 기본값) */
export function parseWorkflow(raw: unknown, stepIds: Set<string>): WorkflowMeta | undefined {
  if (!isObj(raw)) return undefined;
  const wf: WorkflowMeta = {
    ...DEFAULT_WORKFLOW,
    goal: str(raw.goal, 4000),
    defaults: normalizeResources(raw.defaults),
    stepPermission: raw.stepPermission === 'read' ? 'read' : 'status',
    locked: raw.locked === true,
    parallel: Number.isInteger(raw.parallel) ? Math.min(8, Math.max(1, raw.parallel as number)) : 1,
    // 지워진 블록에 대한 제안은 블록 없이 남긴다
    proposals: parseProposals(raw.proposals).map((p) => {
      if (!p.stepId || stepIds.has(p.stepId)) return p;
      const rest = { ...p };
      delete rest.stepId;
      return rest;
    }),
  };
  const dir = str(raw.workingDir, 1000).trim();
  if (dir) wf.workingDir = dir;
  return wf;
}
