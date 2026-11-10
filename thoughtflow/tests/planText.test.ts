import { describe, expect, it } from 'vitest';
import { addFlow, connectBoxes, deleteItems, describeBoard, updateBox } from '../src/ai/boardOps';
import { EMPTY_DOC, type BoxNode, type Doc, type RouteEdge, type StepInfo } from '../src/model/types';
import { newStep } from '../src/workflow/defaults';
import { describeNext, describePlan, workOrder } from '../src/workflow/planText';
import { answerQuestion, askUser, finishStep, sendBack, startStep, type Outcome } from '../src/workflow/transitions';
import type { CatalogItem } from '../src/workflow/catalog';

const box = (id: string, x: number, text: string, step?: Partial<StepInfo>): BoxNode => ({
  id,
  x,
  y: 0,
  width: 180,
  height: 56,
  text,
  note: '',
  ...(step ? { step: { ...newStep(), ...step } } : {}),
});
const edge = (id: string, a: string, b: string): RouteEdge =>
  ({ id, sourceNodeId: a, targetNodeId: b, sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' }, pathPoints: [], pathMode: 'auto' }) as unknown as RouteEdge;

function plan(): Doc {
  return {
    ...EMPTY_DOC,
    nodes: {
      A: box('A', 0, '자료 모으기', {
        goal: '판매 자료를 모은다',
        doneWhen: ['3개월치가 있다'],
        deliverables: [{ path: 'data/sales.csv', spec: '월별 합계' }],
        references: ['docs/sources.md'],
        resources: { skills: ['report-writer'], commands: ['/review-pr'], connectors: ['Gmail'], subagent: { type: 'Explore', instructions: '파일만 찾기' }, avoid: ['메일 보내기'] },
      }),
      B: box('B', 300, '보고서', { goal: '보고서를 쓴다', review: true, approval: 'ask' }),
      T: box('T', 0, '생각'),
    },
    edges: { e1: edge('e1', 'A', 'B'), e2: edge('e2', 'T', 'A') },
    workflow: { goal: '분기 보고서', workingDir: 'C:/work', defaults: { skills: ['dataviz'], commands: [], connectors: [] }, stepPermission: 'status', locked: false, parallel: 1, proposals: [] },
  };
}
const must = (o: Outcome) => {
  if (!o.ok) throw new Error(o.error);
  return o.doc;
};
const catalog: CatalogItem[] = [
  { kind: 'skill', name: 'report-writer', description: '', source: 'user' },
  { kind: 'skill', name: 'dataviz', description: '', source: 'user' },
  { kind: 'subagent', name: 'Explore', description: '', source: 'builtin' },
];

describe('plan as text for Claude', () => {
  it('describes the whole plan in run order with every instruction', () => {
    const t = describePlan(plan(), { projectName: '분기', catalog });
    expect(t).toContain('계획 전체 목표: 분기 보고서');
    expect(t).toContain('작업 폴더: C:/work');
    expect(t.indexOf('1. 자료 모으기 [A]')).toBeLessThan(t.indexOf('2. 보고서 [B]'));
    expect(t).toContain('1. 3개월치가 있다');
    expect(t).toContain('data/sales.csv — 월별 합계');
    expect(t).toContain('Gmail (이 PC의 목록에 없음');
    expect(t).not.toContain('report-writer (이 PC');
    expect(t).toContain('시작 전 사람 승인 필요');
    expect(t).toContain('지금 Claude가 시작할 수 있는 단계: 자료 모으기 [A]');
    expect(describePlan({ ...EMPTY_DOC }, { projectName: 'x' })).toContain('계획 블록이 없습니다');
  });

  it('gives a work order with merged tools, how to use them and how to report', () => {
    const t = workOrder(plan(), 'A', { projectName: '분기', catalog });
    expect(t).toContain('Skill 도구로 "dataviz"');
    expect(t).toContain('Skill 도구로 "report-writer"');
    expect(t).toContain('/review-pr 명령을 실행');
    expect(t).toContain('subagent_type: "Explore"');
    expect(t).toContain('파일만 찾기');
    expect(t).toContain('하지 말 것: 메일 보내기');
    expect(t).toContain('만들 것 1번마다');
    expect(t).toContain('완료 기준 1번마다');
  });

  it('carries send-back reasons, answers and earlier results into the work order', () => {
    let d = must(startStep(plan(), 'A', 'Claude'));
    d = must(askUser(d, 'A', 'Claude', '어느 지역?', undefined, 'q1'));
    d = must(answerQuestion(d, 'A', 'q1', '서울만'));
    d = must(
      finishStep(d, 'A', 'Claude', {
        summary: '모음',
        outputs: [{ deliverable: 1, path: 'data/sales.csv' }],
        criteria: [{ item: 1, pass: true, evidence: '3개월 확인' }],
        used: { skills: [], commands: [], connectors: [] },
      }),
    );
    expect(workOrder(d, 'B', { projectName: 'x' })).toContain('앞 단계 자료 모으기 [A]의 결과: 모음');
    d = must(sendBack(d, 'A', '6개월치로'));
    const t = workOrder(d, 'A', { projectName: 'x' });
    expect(t).toContain('되돌려 보냈습니다. 이유: 6개월치로');
    expect(t).toContain('답: 서울만');
  });

  it('explains why nothing can start', () => {
    let d = plan();
    expect(describeNext(d)).toContain('자료 모으기 [A]');
    d = must(startStep(d, 'A', 'Claude'));
    expect(describeNext(d)).toContain('진행 중: 자료 모으기 [A]');
    d = must(askUser(d, 'A', 'Claude', '?', undefined, 'q'));
    expect(describeNext(d)).toContain('답을 기다리는 중');
    d.workflow = { ...d.workflow!, stepPermission: 'read' };
    expect(describeNext(d)).toContain('읽기만');
  });
});

describe('board tools cannot change the plan', () => {
  it('refuses to edit or delete plan blocks and their order', () => {
    const d = plan();
    expect(updateBox(d, { id: 'A', append_note: 'x' }).ok).toBe(false);
    expect(updateBox(d, { id: 'T', append_note: 'x' }).ok).toBe(true);
    expect(deleteItems(d, { box_ids: ['B'] }).ok).toBe(false);
    expect(deleteItems(d, { routes: [{ from: 'A', to: 'B' }] }).ok).toBe(false);
    expect(deleteItems(d, { routes: [{ from: 'T', to: 'A' }] }).ok).toBe(true);
    expect(connectBoxes(d, 'B', 'A').ok).toBe(false);
    expect(connectBoxes(d, 'T', 'B').ok).toBe(true);
    expect(addFlow(d, { boxes: [{ title: '새 생각' }], routes: [{ from: 'B', to: 'A' }] }, 'Claude', { x: 0, y: 0 }).ok).toBe(false);
    expect(addFlow(d, { boxes: [{ title: '새 생각' }], after: 'B' }, 'Claude', { x: 0, y: 0 }).ok).toBe(true);
  });

  it('marks plan blocks on the board outline', () => {
    const t = describeBoard(plan(), { projectName: 'x' });
    expect(t).toContain('계획 블록 2개');
    expect(t).toContain('자료 모으기 [A] [계획 블록 · 할 일]');
  });
});
