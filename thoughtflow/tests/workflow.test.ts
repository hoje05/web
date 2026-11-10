import { describe, expect, it } from 'vitest';
import type { BoxNode, Doc, RouteEdge, StepInfo } from '../src/model/types';
import { parseBoard, serializeBoard } from '../src/persistence/fileFormat';
import { newStep } from '../src/workflow/defaults';
import { effectiveStatuses, nextSteps, planFingerprint, progress, stepOrder } from '../src/workflow/graph';
import { cleanName, mergeResources, normalizeResources, resourceDiff } from '../src/workflow/resources';
import {
  HUMAN,
  acceptReview,
  answerQuestion,
  approveStep,
  askUser,
  editStepPlan,
  editWorkflow,
  failStep,
  finishStep,
  proposeChange,
  requestApproval,
  resolveProposal,
  sendBack,
  setStatusByHuman,
  setStepEnabled,
  startStep,
  type Outcome,
} from '../src/workflow/transitions';

const AT = '2026-11-08T10:00:00.000Z';
const box = (id: string, x: number, y = 0, step?: Partial<StepInfo>): BoxNode => ({
  id,
  x,
  y,
  width: 180,
  height: 56,
  text: id,
  note: '',
  ...(step ? { step: { ...newStep(`${id} 하기`), ...step } } : {}),
});
const route = (id: string, a: string, b: string): RouteEdge => ({
  id,
  sourceNodeId: a,
  targetNodeId: b,
  sourceAnchor: { side: 'right' },
  targetAnchor: { side: 'left' },
  pathPoints: [],
  pathMode: 'auto',
});
const docOf = (nodes: BoxNode[], edges: RouteEdge[] = []): Doc => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  edges: Object.fromEntries(edges.map((e) => [e.id, e])),
  tags: {},
});
const okDoc = (o: Outcome): Doc => {
  if (!o.ok) throw new Error(o.error);
  return o.doc;
};
const errOf = (o: Outcome): string => {
  if (o.ok) throw new Error('expected an error');
  return o.error;
};
const statusOf = (d: Doc, id: string) => d.nodes[id].step!.status;

/** 설계 → 구현 → 검사, 그리고 따로 떨어진 생각 Box (순서에 안 들어감) */
const plan = () =>
  docOf(
    [
      box('design', 0, 0, { doneWhen: ['화면 3개 그림'], deliverables: [{ path: 'docs/ui.md', spec: '화면 설명' }] }),
      box('build', 300, 0, { resources: { skills: ['dataviz'], commands: ['/review'], connectors: [] } }),
      box('test', 600, 0, { review: true }),
      box('idea', 300, 200),
    ],
    [route('r1', 'design', 'build'), route('r2', 'build', 'test'), route('r3', 'idea', 'build')],
  );

describe('workflow graph', () => {
  it('orders steps by routes, left to right, ignoring thought boxes', () => {
    const d = docOf([box('c', 600, 0, {}), box('a', 0, 0, {}), box('b2', 300, 100, {}), box('b1', 300, 0, {}), box('n', 0, 300)], [
      route('1', 'a', 'b1'),
      route('2', 'a', 'b2'),
      route('3', 'b1', 'c'),
      route('4', 'b2', 'c'),
      route('5', 'n', 'a'),
    ]);
    expect(stepOrder(d)).toEqual({ order: ['a', 'b1', 'b2', 'c'], cycle: [] });
  });

  it('computes ready / todo / blocked and the next step', () => {
    let d = plan();
    expect(Object.fromEntries(effectiveStatuses(d))).toEqual({ design: 'ready', build: 'todo', test: 'todo' });
    expect(nextSteps(d)).toEqual(['design']);
    d = okDoc(setStatusByHuman(d, 'design', 'done', undefined, AT));
    expect(effectiveStatuses(d).get('build')).toBe('ready');
    d = okDoc(setStatusByHuman(d, 'build', 'failed', undefined, AT));
    expect(effectiveStatuses(d).get('test')).toBe('blocked');
    expect(nextSteps(d)).toEqual([]);
    expect(progress(d)).toMatchObject({ total: 3, done: 1, failed: 1 });
  });

  it('marks steps in a cycle as blocked', () => {
    const d = docOf([box('a', 0, 0, {}), box('b', 300, 0, {}), box('c', 600, 0, {})], [route('1', 'a', 'b'), route('2', 'b', 'a'), route('3', 'b', 'c')]);
    expect(stepOrder(d).cycle).toEqual(['a', 'b']);
    expect(Object.fromEntries(effectiveStatuses(d))).toEqual({ a: 'blocked', b: 'blocked', c: 'blocked' });
  });

  it('limits next steps to the parallel setting', () => {
    let d = docOf([box('a', 0, 0, {}), box('b', 0, 100, {}), box('c', 0, 200, {})]);
    expect(nextSteps(d)).toEqual(['a']);
    d = okDoc(editWorkflow(d, { parallel: 2 }));
    expect(nextSteps(d)).toEqual(['a', 'b']);
    d = okDoc(startStep(d, 'a', 'Claude', AT));
    expect(nextSteps(d)).toEqual(['b']);
    expect(nextSteps(d, 'human')).toEqual([]);
  });

  it('fingerprints only the human-written plan', () => {
    const d = plan();
    const f = planFingerprint(d);
    const moved = { ...d, nodes: { ...d.nodes, build: { ...d.nodes.build, x: 999 } } };
    expect(planFingerprint(moved)).toBe(f);
    expect(planFingerprint(okDoc(startStep(d, 'design', 'Claude', AT)))).toBe(f);
    expect(planFingerprint(okDoc(editStepPlan(d, 'build', { doneWhen: ['테스트 통과'] })))).not.toBe(f);
    expect(planFingerprint(docOf(Object.values(d.nodes), [route('r1', 'design', 'build')]))).not.toBe(f);
  });
});

describe('workflow transitions', () => {
  it('only lets humans change the plan, and not while it is locked', () => {
    let d = plan();
    d = okDoc(editStepPlan(d, 'build', { goal: '  로그인 화면 만들기 ', doneWhen: ['빌드 통과', ' '], resources: { skills: ['pdf', 'PDF'], commands: ['review'], connectors: [] } }));
    expect(d.nodes.build.step).toMatchObject({ goal: '로그인 화면 만들기', doneWhen: ['빌드 통과'], resources: { skills: ['pdf'], commands: ['/review'] } });
    d = okDoc(editWorkflow(d, { locked: true }));
    expect(errOf(editStepPlan(d, 'build', { goal: 'x' }))).toContain('잠겨');
    expect(errOf(setStepEnabled(d, 'idea', true))).toContain('잠겨');
    expect(errOf(editWorkflow(d, { goal: 'x' }))).toContain('잠겨');
    d = okDoc(editWorkflow(d, { locked: false, goal: '앱 만들기' }));
    expect(d.workflow).toMatchObject({ locked: false, goal: '앱 만들기' });
  });

  it('turns boxes into steps and back', () => {
    let d = okDoc(setStepEnabled(plan(), 'idea', true));
    expect(d.nodes.idea.step?.status).toBe('todo');
    d = okDoc(setStepEnabled(d, 'idea', false));
    expect(d.nodes.idea.step).toBeUndefined();
  });

  it('starts only in order, only for Claude steps, within the parallel limit', () => {
    let d = plan();
    expect(errOf(startStep(d, 'build', 'Claude', AT))).toContain('앞 단계');
    d = okDoc(startStep(d, 'design', 'Claude', AT));
    expect(statusOf(d, 'design')).toBe('running');
    expect(d.nodes.design.step!.log).toEqual([{ at: AT, by: 'Claude', status: 'running' }]);
    const human = okDoc(editStepPlan(plan(), 'design', { assignee: 'human' }));
    expect(errOf(startStep(human, 'design', 'Claude', AT))).toContain('사람이 하는');
    expect(startStep(human, 'design', HUMAN, AT).ok).toBe(true);
    const two = docOf([box('a', 0, 0, {}), box('b', 0, 100, {})]);
    expect(errOf(startStep(okDoc(startStep(two, 'a', 'Claude', AT)), 'b', 'Claude', AT))).toContain('동시에 1개');
  });

  it('needs approval for steps that ask for it', () => {
    let d = okDoc(editStepPlan(plan(), 'design', { approval: 'ask' }));
    expect(errOf(startStep(d, 'design', 'Claude', AT))).toContain('승인');
    d = okDoc(requestApproval(d, 'design', 'Claude', '배포 전에 확인', AT));
    expect(statusOf(d, 'design')).toBe('waiting');
    d = okDoc(approveStep(d, 'design', AT));
    expect(d.nodes.design.step).toMatchObject({ status: 'todo', approved: true });
    d = okDoc(startStep(d, 'design', 'Claude', AT));
    expect(statusOf(d, 'design')).toBe('running');
  });

  it('refuses to finish until every deliverable and criterion is reported', () => {
    let d = okDoc(startStep(plan(), 'design', 'Claude', AT));
    const used = { skills: [], commands: [], connectors: [] };
    const err = errOf(finishStep(d, 'design', 'Claude', { summary: '끝', outputs: [], criteria: [], used }, AT));
    expect(err).toContain('만들 것 1번');
    expect(err).toContain('완료 기준 1번');
    expect(errOf(finishStep(d, 'design', 'Claude', { summary: '끝', outputs: [{ deliverable: 1, path: 'docs/ui.md' }], criteria: [{ item: 1, pass: false, evidence: '2개뿐' }], used }, AT))).toContain(
      '통과하지 못했습니다',
    );
    d = okDoc(
      finishStep(d, 'design', 'Claude', { summary: '화면 설계 끝', outputs: [{ deliverable: 1, path: 'docs/ui.md' }], criteria: [{ item: 1, pass: true, evidence: '3개 그림' }], used }, AT),
    );
    expect(d.nodes.design.step).toMatchObject({ status: 'done', result: { summary: '화면 설계 끝', planVersion: planFingerprint(plan()), by: 'Claude' } });
    expect(effectiveStatuses(d).get('build')).toBe('ready');
  });

  it('sends steps with review to the user before they count as done', () => {
    let d = plan();
    for (const id of ['design', 'build']) d = okDoc(setStatusByHuman(d, id, 'done', undefined, AT));
    d = okDoc(startStep(d, 'test', 'Claude', AT));
    d = okDoc(finishStep(d, 'test', 'Claude', { summary: '테스트 끝', outputs: [], criteria: [], used: { skills: [], commands: [], connectors: [] } }, AT));
    expect(statusOf(d, 'test')).toBe('review');
    expect(okDoc(acceptReview(d, 'test', AT)).nodes.test.step!.status).toBe('done');
    const back = okDoc(sendBack(d, 'test', '경계값 테스트 빠짐', AT));
    expect(back.nodes.test.step!.status).toBe('todo');
    expect(back.nodes.test.step!.log.at(-1)).toMatchObject({ by: HUMAN, note: '다시 하기: 경계값 테스트 빠짐' });
  });

  it('asks the user instead of guessing, and continues after the answer', () => {
    let d = okDoc(startStep(plan(), 'design', 'Claude', AT));
    d = okDoc(askUser(d, 'design', 'Claude', '어두운 화면도 만들까요?', AT, 'q1'));
    expect(statusOf(d, 'design')).toBe('asking');
    expect(errOf(finishStep(d, 'design', 'Claude', { summary: '', outputs: [], criteria: [], used: { skills: [], commands: [], connectors: [] } }, AT))).toContain('진행 중인');
    d = okDoc(answerQuestion(d, 'design', 'q1', '아니요, 밝은 화면만', AT));
    expect(d.nodes.design.step).toMatchObject({ status: 'running', questions: [{ id: 'q1', answer: '아니요, 밝은 화면만' }] });
  });

  it('records failures with a reason and blocks what follows', () => {
    let d = okDoc(startStep(plan(), 'design', 'Claude', AT));
    expect(errOf(failStep(d, 'design', 'Claude', ' ', AT))).toContain('이유');
    d = okDoc(failStep(d, 'design', 'Claude', '디자인 자료가 없음', AT));
    expect(statusOf(d, 'design')).toBe('failed');
    expect(effectiveStatuses(d).get('build')).toBe('blocked');
  });

  it('keeps plan changes from the AI as proposals only', () => {
    let d = okDoc(proposeChange(plan(), 'Claude', { stepId: 'build', change: '완료 기준에 "빌드 통과" 추가', why: '검증 방법이 없음' }, AT, 'p1'));
    expect(d.nodes.build.step!.doneWhen).toEqual([]);
    expect(d.workflow!.proposals).toEqual([{ id: 'p1', at: AT, by: 'Claude', stepId: 'build', change: '완료 기준에 "빌드 통과" 추가', why: '검증 방법이 없음', state: 'open' }]);
    d = okDoc(resolveProposal(d, 'p1', true));
    expect(d.workflow!.proposals[0].state).toBe('accepted');
  });

  it('lets the AI only read when the board says so', () => {
    const d = okDoc(editWorkflow(plan(), { stepPermission: 'read' }));
    expect(errOf(startStep(d, 'design', 'Claude', AT))).toContain('읽기만');
    expect(errOf(proposeChange(d, 'Claude', { change: 'x', why: '' }, AT))).toContain('읽기만');
    expect(startStep(d, 'design', HUMAN, AT).ok).toBe(true);
  });
});

describe('workflow resources', () => {
  it('cleans names', () => {
    expect(cleanName('command', ' review  pr ')).toBe('/review pr');
    expect(normalizeResources({ skills: ['a', ' A ', 3], subagent: { type: ' Explore ', model: '' }, avoid: ['배포 금지', '배포 금지'] })).toEqual({
      skills: ['a'],
      commands: [],
      connectors: [],
      subagent: { type: 'Explore' },
      avoid: ['배포 금지'],
    });
    expect(normalizeResources(null)).toEqual({ skills: [], commands: [], connectors: [] });
  });

  it('merges board defaults with step tools', () => {
    expect(
      mergeResources(
        { skills: ['pdf'], commands: [], connectors: ['github'], subagent: { type: 'general-purpose' } },
        { skills: ['PDF', 'dataviz'], commands: ['/review'], connectors: [], subagent: { type: 'Explore' } },
      ),
    ).toEqual({ skills: ['pdf', 'dataviz'], commands: ['/review'], connectors: ['github'], subagent: { type: 'Explore' } });
  });

  it('shows what was specified but not used, and what was used but not specified', () => {
    const diff = resourceDiff(
      { skills: ['dataviz'], commands: ['/review'], connectors: [], subagent: { type: 'Explore' } },
      { skills: ['DataViz', 'pdf'], commands: [], connectors: ['Gmail'] },
    );
    expect(diff).toEqual({
      missing: [
        { kind: 'command', name: '/review' },
        { kind: 'subagent', name: 'Explore' },
      ],
      extra: [
        { kind: 'skill', name: 'pdf' },
        { kind: 'connector', name: 'Gmail' },
      ],
    });
  });
});

describe('workflow file format (v4)', () => {
  it('saves and reads back steps and plan settings', () => {
    let d = okDoc(startStep(plan(), 'design', 'Claude', AT));
    d = okDoc(askUser(d, 'design', 'Claude', '색은?', AT, 'q1'));
    d = okDoc(editWorkflow(d, { goal: '앱 만들기', defaults: { skills: ['pdf'], commands: [], connectors: [] }, parallel: 2, workingDir: 'C:\\work\\app' }));
    d = okDoc(proposeChange(d, 'Claude', { stepId: 'build', change: 'x', why: 'y' }, AT, 'p1'));
    const text = serializeBoard(d, { zoom: 1, panX: 0, panY: 0 });
    expect(JSON.parse(text).version).toBe(4);
    const { doc: back, warnings } = parseBoard(text);
    expect(warnings).toEqual([]);
    expect(back.nodes).toEqual(d.nodes);
    expect(back.workflow).toEqual(d.workflow);
    expect(back.nodes.idea.step).toBeUndefined();
  });

  it('opens v3 files without plans, and repairs damaged plan data', () => {
    const v3 = JSON.stringify({ format: 'thoughtflow', version: 3, nodes: [{ id: 'a', x: 0, y: 0, text: 'A', note: '' }], edges: [] });
    const { doc } = parseBoard(v3);
    expect(doc.nodes.a.step).toBeUndefined();
    expect(doc.workflow).toBeUndefined();

    const bad = JSON.stringify({
      format: 'thoughtflow',
      version: 4,
      nodes: [
        { id: 'a', x: 0, y: 0, text: 'A', note: '', step: { status: 'flying', doneWhen: ['ok', 3], deliverables: [{ spec: '' }, { path: 'x.ts', spec: 'x' }], resources: { skills: 'pdf' }, approved: true } },
        { id: 'b', x: 0, y: 0, text: 'B', note: '', step: 'nope' },
      ],
      edges: [],
      workflow: { parallel: 99, stepPermission: 'all', proposals: [{ id: 'p', change: 'c', stepId: 'gone', state: 'weird' }] },
    });
    const { doc: fixed } = parseBoard(bad);
    expect(fixed.nodes.a.step).toMatchObject({ status: 'todo', doneWhen: ['ok'], deliverables: [{ path: 'x.ts', spec: 'x' }], resources: { skills: [] } });
    expect(fixed.nodes.a.step!.approved).toBeUndefined();
    expect(fixed.nodes.b.step).toBeUndefined();
    expect(fixed.workflow).toMatchObject({ parallel: 8, stepPermission: 'status', proposals: [{ id: 'p', state: 'open' }] });
    expect(fixed.workflow!.proposals[0].stepId).toBeUndefined();
  });
});

describe('plan check', () => {
  it('lists what would stop or weaken the plan', async () => {
    const { planIssues } = await import('../src/workflow/check');
    expect(planIssues(docOf([box('n', 0)]))).toEqual([]);
    let d = docOf([box('a', 0, 0, { goal: '' }), box('b', 300, 0, {}), box('c', 600, 0, {})], [route('1', 'a', 'b'), route('2', 'b', 'a')]);
    d = okDoc(askUser(okDoc(startStep(okDoc(setStatusByHuman(d, 'c', 'todo')), 'c', 'Claude', AT)), 'c', 'Claude', '색은?', AT, 'q'));
    d = okDoc(proposeChange(d, 'Claude', { change: 'x', why: '' }, AT, 'p'));
    const issues = planIssues(d).map((i) => `${i.level}:${i.stepId ?? '-'}:${i.text.slice(0, 12)}`);
    expect(issues[0]).toMatch(/^error:a:순서가 돌고 돕니다/);
    expect(issues).toContain('warn:-:계획 전체 목표가 비어');
    expect(planIssues(d).some((i) => i.stepId === 'c' && i.text.includes('색은?'))).toBe(true);
    expect(planIssues(d).some((i) => i.level === 'warn' && i.text.includes('완료 기준이 없어'))).toBe(true);
    expect(planIssues(d).at(-1)?.text).toContain('수정 제안 1개');
  });
});
