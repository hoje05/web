/** 계획 블록·계획 설정의 기본값 */
import type { Doc, StepInfo, StepResources, WorkflowMeta } from '../model/types';

export const emptyResources = (): StepResources => ({ skills: [], commands: [], connectors: [] });

export function newStep(goal = ''): StepInfo {
  return {
    status: 'todo',
    goal,
    doneWhen: [],
    deliverables: [],
    references: [],
    assignee: 'claude',
    approval: 'auto',
    review: false,
    resources: emptyResources(),
    questions: [],
    log: [],
  };
}

export const DEFAULT_WORKFLOW: WorkflowMeta = {
  goal: '',
  defaults: { skills: [], commands: [], connectors: [] },
  stepPermission: 'status',
  locked: false,
  parallel: 1,
  proposals: [],
};

/** 보드의 계획 설정 (없으면 기본값) */
export const workflowOf = (doc: Doc): WorkflowMeta => doc.workflow ?? DEFAULT_WORKFLOW;
