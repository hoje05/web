// 워크플로우 4단계 — Claude가 MCP로 계획을 읽고 사람이 설계한 대로 진행한다.
//  get_plan → report_capabilities → next_steps → start_step(작업 지시서) → ask_user(사용자가 답) → finish_step(검사) → 검토
//  승인이 필요한 단계, 사람이 하는 단계, 계획 블록은 보드 도구로 고칠 수 없음, 수정 제안, 읽기만 권한.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { assert, launch, shutdown } from './harness.mjs';

let { app, win, sandbox } = await launch([], { autoPanel: true });
const text = (r) => r.content.map((c) => c.text).join('\n');
const step = (id) => win.evaluate((id) => window.__tf.getState().doc.nodes[id].step, id);

const claude = new Client({ name: 'claude-ai', version: '1.0.0' });
await claude.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['dist-mcp/bundle/server/index.js'],
    env: {
      ...process.env,
      THOUGHTFLOW_BRIDGE_FILE: join(sandbox.userData, 'bridge.json'),
      THOUGHTFLOW_USER_DATA: sandbox.userData,
      THOUGHTFLOW_BOARDS_DIR: sandbox.boards,
    },
  }),
);
const call = (name, args = {}) => claude.callTool({ name, arguments: args });

try {
  // 사람이 만든 계획: 자료 모으기(Claude) → 초안(Claude, 승인 필요, 검토) → 확인(사람)
  await win.evaluate(() => {
    const s = window.__tf.getState();
    const base = { status: 'todo', doneWhen: [], deliverables: [], references: [], assignee: 'claude', approval: 'auto', review: false, resources: { skills: [], commands: [], connectors: [] }, questions: [], log: [] };
    const box = (id, x, text, step) => ({ id, x, y: 0, width: 180, height: 56, text, note: '', step: { ...base, ...step } });
    const edge = (id, a, b) => ({ id, sourceNodeId: a, targetNodeId: b, sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' }, pathPoints: [], pathMode: 'auto' });
    s.commit({
      ...s.doc,
      nodes: {
        A: box('A', 0, '자료 모으기', {
          goal: '판매 자료를 모은다',
          doneWhen: ['3개월치가 있다'],
          deliverables: [{ path: 'data/sales.csv', spec: '월별 합계' }],
          resources: { skills: ['report-writer'], commands: [], connectors: ['Gmail'], subagent: { type: 'Explore' } },
        }),
        B: box('B', 300, '초안', { goal: '보고서 초안', approval: 'ask', review: true }),
        C: box('C', 600, '확인', { goal: '사람이 읽어 본다', assignee: 'human' }),
      },
      edges: { e1: edge('e1', 'A', 'B'), e2: edge('e2', 'B', 'C') },
      workflow: { goal: '분기 보고서', defaults: { skills: [], commands: [], connectors: [] }, stepPermission: 'status', locked: false, parallel: 1, proposals: [] },
    });
  });

  const tools = (await claude.listTools()).tools.map((t) => t.name);
  assert(['get_plan', 'next_steps', 'start_step', 'finish_step', 'ask_user', 'propose_change', 'report_capabilities'].every((t) => tools.includes(t)), 'plan tools are listed');
  assert(!tools.some((t) => /create_plan|edit_plan|update_step/.test(t)), 'there is no tool for Claude to write the plan');
  const prompts = (await claude.listPrompts()).prompts.map((p) => p.name);
  assert(prompts.includes('run_plan'), 'run_plan prompt');

  // ── 계획 읽기
  let r = await call('get_plan');
  let t = text(r);
  assert(t.includes('계획 전체 목표: 분기 보고서') && t.indexOf('자료 모으기 [A]') < t.indexOf('초안 [B]') && t.indexOf('초안 [B]') < t.indexOf('확인 [C]'), 'get_plan: goal and steps in order');
  assert(t.includes('3개월치가 있다') && t.includes('data/sales.csv'), 'get_plan: criteria and deliverables');
  assert(text(await call('get_board')).includes('[계획 블록 · 할 일]'), 'get_board marks plan blocks');

  // ── 도구 확인: 계획에 있는데 Claude에게 없는 것
  r = await call('report_capabilities', { skills: ['report-writer'], connectors: ['github'], subagents: ['Explore', 'general-purpose'] });
  t = text(r);
  assert(t.includes('커넥터 Gmail') && !t.includes('스킬 report-writer'), `missing plan tools are reported (${t})`);

  // ── 순서 지키기
  r = await call('start_step', { id: 'B' });
  assert(r.isError && text(r).includes('앞 단계'), 'cannot start a step before earlier ones are done');
  assert(text(await call('next_steps')).includes('자료 모으기 [A]'), 'next_steps names the first step');

  // ── 시작 → 작업 지시서
  r = await call('start_step', { id: 'A' });
  t = text(r);
  assert(!r.isError && t.includes('[작업 지시서]') && t.includes('Skill 도구로 "report-writer"') && t.includes('subagent_type: "Explore"'), 'start_step returns the work order with tool instructions');
  assert((await step('A')).status === 'running', 'step is running');
  await win.waitForSelector('[data-testid=ai-toast]');
  assert((await win.textContent('[data-testid=ai-toast]')).includes('자료 모으기'), 'the user sees what Claude started');

  // ── 계획 블록은 보드 도구로 고칠 수 없다
  r = await call('update_box', { id: 'A', append_note: '내 마음대로' });
  assert(r.isError && text(r).includes('사용자만'), 'update_box refuses plan blocks');
  r = await call('connect_boxes', { from: 'C', to: 'A' });
  assert(r.isError, 'connect_boxes refuses to change the step order');
  assert((await win.evaluate(() => window.__tf.getState().doc.nodes.A.note)) === '', 'plan block unchanged');

  // ── 질문 → 사용자가 앱에서 답함
  r = await call('ask_user', { id: 'A', question: '어느 지역 자료를 쓸까요?' });
  assert(!r.isError && (await step('A')).status === 'asking', 'ask_user → asking');
  await win.evaluate(() => window.__tf.getState().openPage('A', { force: true }));
  await win.waitForSelector('[data-testid=step-question-box]');
  await win.fill('[data-testid=step-answer]', '서울만');
  await win.click('[data-testid=step-answer-send]');
  assert((await step('A')).status === 'running', 'answering resumes the step');
  assert(text(await call('get_plan', { id: 'A' })).includes('답: 서울만'), 'Claude reads the answer');
  await call('log_step', { id: 'A', note: '서울 자료 3개월치 내려받음' });

  // ── 끝내기: 계획과 맞지 않으면 거부
  r = await call('finish_step', { id: 'A', summary: '모음', outputs: [], criteria: [{ item: 1, pass: true, evidence: '확인' }], used: {} });
  assert(r.isError && text(r).includes('만들 것 1번'), `finish without a deliverable is refused (${text(r)})`);
  r = await call('finish_step', { id: 'A', summary: '모음', outputs: [{ deliverable: 1, path: 'data/sales.csv' }], criteria: [{ item: 1, pass: false, evidence: '2개월치뿐' }], used: {} });
  assert(r.isError && text(r).includes('통과하지 못했습니다'), 'a failed criterion is not done');
  r = await call('finish_step', {
    id: 'A',
    summary: '서울 3개월 판매 자료',
    outputs: [{ deliverable: 1, path: 'data/sales.csv' }],
    criteria: [{ item: 1, pass: true, evidence: '1~3월 행 확인' }],
    used: { skills: ['report-writer'], subagent: { type: 'Explore' } },
  });
  t = text(r);
  assert(!r.isError && (await step('A')).status === 'done' && t.includes('초안 [B]'), `finish_step → done, then tells the next step (${t})`);
  assert((await step('A')).result.used.skills[0] === 'report-writer', 'result keeps the tools actually used');

  // ── 승인이 필요한 단계
  r = await call('start_step', { id: 'B' });
  assert(r.isError && text(r).includes('승인'), 'approval needed');
  await call('request_approval', { id: 'B', why: '초안을 씁니다' });
  assert((await step('B')).status === 'waiting', 'waiting for approval');
  assert(text(await call('next_steps')).includes('승인을 기다리는 중'), 'next_steps explains the wait');
  await win.evaluate(() => window.__tf.getState().openPage('B', { force: true }));
  await win.click('[data-testid=step-approve]');
  r = await call('start_step', { id: 'B' });
  assert(!r.isError, 'starts after the user approves');
  r = await call('propose_change', { step_id: 'B', change: '그래프를 하나 더', why: '비교가 쉬움' });
  assert(!r.isError && (await win.evaluate(() => window.__tf.getState().doc.workflow.proposals.length)) === 1, 'proposals are recorded, plan unchanged');
  await call('finish_step', { id: 'B', summary: '초안', outputs: [], criteria: [], used: {} });
  assert((await step('B')).status === 'review', 'review step waits for the user');
  assert(text(await call('next_steps')).includes('검토를 기다리는 중'), 'waiting for review');
  await win.click('[data-testid=step-accept]');

  // ── 사람이 하는 단계
  r = await call('start_step', { id: 'C' });
  assert(r.isError && text(r).includes('사람이 하는 단계'), 'Claude cannot start a person’s step');
  assert(text(await call('next_steps')).includes('사람이 할 단계'), 'next_steps says the person is next');

  // ── 읽기만 권한
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, workflow: { ...s.doc.workflow, stepPermission: 'read' } });
  });
  r = await call('propose_change', { change: 'x' });
  assert(r.isError && text(r).includes('읽기만'), 'read-only plans refuse status writes');

  // ── Undo 한 칸 = AI의 한 번
  const past = await win.evaluate(() => window.__tf.getState().past.length);
  assert(past >= 10, `each plan change is one undo step (${past})`);
  await win.screenshot({ path: 'e2e/out/phase29-plan-run.png' });
  console.log('PHASE 29 OK');
} finally {
  await claude.close().catch(() => {});
  await shutdown(app);
}
