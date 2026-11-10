// 워크플로우 2단계 — 화면: 계획 블록 만들기·설정(할 일·완료 기준·만들 것·도구), 보드의 상태 표시, 계획 창(순서·점검·잠금),
// 사람이 하는 일(승인·질문에 답하기·검토), 계획 대비 결과, Undo, 다시 열기.
import { readFileSync } from 'node:fs';
import { assert, launch, shutdown } from './harness.mjs';

let { app, win, sandbox } = await launch([], { autoPanel: true });
const step = (id) => win.evaluate((i) => window.__tf.getState().doc.nodes[i].step ?? null, id);
const boxStatus = (id) => win.getAttribute(`[data-node-id="${id}"]`, 'data-step');
const open = (id) => win.evaluate((i) => window.__tf.getState().openPage(i, { force: true }), id);
const past = () => win.evaluate(() => window.__tf.getState().past.length);
/** 사람이 아닌 Claude가 한 것처럼 상태를 바꿔 둔다 (Claude의 MCP 도구는 4단계) */
const setStep = (id, patch) =>
  win.evaluate(
    ([i, p]) => {
      const s = window.__tf.getState();
      const n = s.doc.nodes[i];
      s.commit({ ...s.doc, nodes: { ...s.doc.nodes, [i]: { ...n, step: { ...n.step, ...p } } } });
    },
    [id, patch],
  );

try {
  await win.evaluate(() => {
    const s = window.__tf.getState();
    const box = (id, x, y, text) => ({ id, x, y, width: 180, height: 56, text, note: '' });
    const route = (id, a, b) => ({ id, sourceNodeId: a, targetNodeId: b, sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' }, pathPoints: [], pathMode: 'auto' });
    s.commit({
      ...s.doc,
      nodes: { A: box('A', -400, 0, '화면 설계'), B: box('B', -100, 0, '로그인 구현'), C: box('C', 200, 0, '테스트'), N: box('N', -100, 200, '아이디어') },
      edges: { r1: route('r1', 'A', 'B'), r2: route('r2', 'B', 'C'), r3: route('r3', 'N', 'B') },
    });
    s.setPanelWidth(560);
  });
  await open('A');

  // ── 계획 블록으로 만들기
  await win.click('[data-testid=step-enable]');
  await win.waitForSelector('[data-testid=step-props]');
  assert((await step('A'))?.status === 'todo', 'a box becomes a plan block');
  assert((await boxStatus('A')) === 'ready', 'the board shows it can start now (no steps before it)');

  // ── 계획 쓰기: 할 일 · 완료 기준 · 만들 것 · 참고 · 도구
  await win.fill('[data-testid=step-goal]', '로그인 화면 3개를 설계한다');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=step-done-add]', '화면 3개 모두 그림');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=step-done-add]', '오류 문구 정의');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=step-deliv-path]', 'docs/login-ui.md');
  await win.fill('[data-testid=step-deliv-spec]', '화면별 요소와 문구');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=step-ref-add]', 'docs/brand.md');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=res-skill-add]', 'dataviz');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=res-command-add]', 'review');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=res-connector-add]', 'Figma');
  await win.keyboard.press('Enter');
  await win.fill('[data-testid=res-subagent-type]', 'Explore');
  await win.keyboard.press('Enter');
  await win.click('[data-testid=step-review]');
  let s = await step('A');
  assert(s.goal === '로그인 화면 3개를 설계한다', 'goal is saved on Enter');
  assert(JSON.stringify(s.doneWhen) === '["화면 3개 모두 그림","오류 문구 정의"]', 'done criteria are a checklist');
  assert(JSON.stringify(s.deliverables) === '[{"path":"docs/login-ui.md","spec":"화면별 요소와 문구"}]', 'deliverable = path + condition');
  assert(JSON.stringify(s.references) === '["docs/brand.md"]', 'references');
  assert(
    JSON.stringify(s.resources) === '{"skills":["dataviz"],"commands":["/review"],"connectors":["Figma"],"subagent":{"type":"Explore"}}',
    `tools: skill, command (with /), connector, sub-agent (${JSON.stringify(s.resources)})`,
  );
  assert(s.review === true, 'review before moving on');
  assert((await win.textContent('[data-node-id="A"] [data-testid=box-tools]')).trim() === '4', 'the board box shows how many tools the step uses');

  // 하나 빼기 + Undo (한 칸씩)
  const before = await past();
  await win.click('[data-testid=step-done-remove] >> nth=1');
  assert((await step('A')).doneWhen.length === 1, 'removing a criterion');
  await win.evaluate(() => document.activeElement?.blur());
  await win.keyboard.press('Control+z');
  assert((await step('A')).doneWhen.length === 2 && (await past()) === before, 'Ctrl+Z brings it back (each edit is one undo step)');

  // ── 다른 Box도 계획 블록으로 (오른쪽 클릭 메뉴)
  for (const id of ['B', 'C']) {
    await win.click(`[data-node-id="${id}"]`, { button: 'right' });
    await win.click('[data-testid=context-step]');
  }
  assert((await step('B')) && (await step('C')) && !(await step('N')), 'right-click → make plan block; the thought box stays a thought box');
  assert((await boxStatus('B')) === 'todo' && (await boxStatus('C')) === 'todo', 'later steps wait for the ones before them');
  assert((await win.textContent('[data-testid=workflow-progress]')) === '0/3', 'the title bar shows plan progress');

  // ── 계획 창: 순서 · 점검 · 잠금
  await win.click('[data-testid=workflow-button]');
  await win.waitForSelector('[data-testid=workflow-panel]');
  const names = await win.$$eval('[data-testid=wf-step] .wf-step-name', (els) => els.map((e) => e.textContent));
  assert(JSON.stringify(names) === '["화면 설계","로그인 구현","테스트"]', `steps in route order (${names})`);
  const issues = await win.$$eval('[data-testid=wf-issue]', (els) => els.map((e) => e.textContent));
  assert(issues.some((t) => t.includes('계획 전체 목표')) && issues.some((t) => t.includes("'로그인 구현': 할 일이 비어")), 'plan check lists what is missing');
  await win.fill('[data-testid=wf-goal]', '로그인 기능 만들기');
  // 목표 칸을 떠나며 저장 → 그다음 잠금 (점검 목록이 줄어 창 안 위치가 바뀌므로 칸을 먼저 떠난다)
  await win.evaluate(() => document.activeElement?.blur());
  await win.click('[data-testid=wf-lock]');
  let wf = await win.evaluate(() => window.__tf.getState().doc.workflow);
  assert(wf.goal === '로그인 기능 만들기' && wf.locked === true, 'plan goal saved, plan locked');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid=workflow-panel]', { state: 'detached' });
  await open('A');
  assert(await win.isDisabled('[data-testid=step-goal]'), 'while locked, the plan cannot be edited (even by people)');
  await win.click('[data-testid=workflow-button]');
  await win.click('[data-testid=wf-lock]');
  await win.keyboard.press('Escape');

  // ── 사람이 하는 일: 승인
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.openPage('B', { force: true });
  });
  await win.click('[data-testid=step-approval]');
  await setStep('A', { status: 'done' });
  assert((await boxStatus('B')) === 'ready', 'when the step before is done, the next one can start');
  await setStep('B', { status: 'waiting', log: [{ at: '2026-11-09T09:00:00Z', by: 'Claude', status: 'waiting', note: '배포 설정을 바꿉니다' }] });
  await win.waitForSelector('[data-testid=step-approve]');
  assert((await win.textContent('[data-testid=step-approve-box]')).includes('배포 설정을 바꿉니다'), 'Claude asks for approval with a reason');
  await win.click('[data-testid=step-approve]');
  s = await step('B');
  assert(s.status === 'todo' && s.approved === true && s.log.at(-1).by === '사람', 'approve → Claude may start it');

  // ── 질문에 답하기
  await setStep('B', { status: 'asking', questions: [{ id: 'q1', at: '2026-11-09T09:05:00Z', by: 'Claude', question: '비밀번호 찾기도 만들까요?' }] });
  await win.waitForSelector('[data-testid=step-answer]');
  assert((await boxStatus('B')) === 'asking', 'the board shows a question is waiting');
  await win.fill('[data-testid=step-answer]', '아니요, 다음 계획에서');
  await win.click('[data-testid=step-answer-send]');
  s = await step('B');
  assert(s.status === 'running' && s.questions[0].answer === '아니요, 다음 계획에서', 'answering lets Claude continue');

  // ── 검토 + 계획 대비 결과
  await open('A');
  await setStep('A', {
    status: 'review',
    result: {
      summary: '화면 설계 완료',
      outputs: [{ deliverable: 1, path: 'docs/login-ui.md' }],
      criteria: [
        { item: 1, pass: true, evidence: '3개 화면' },
        { item: 2, pass: true, evidence: '오류 문구 6개' },
      ],
      used: { skills: ['dataviz'], commands: [], connectors: ['Figma', 'Gmail'], subagent: { type: 'Explore' } },
      planVersion: 'old',
      at: '2026-11-09T09:10:00Z',
      by: 'Claude',
    },
  });
  await win.waitForSelector('[data-testid=step-result]');
  assert((await win.$$eval('[data-testid=step-result-criteria] .is-ok', (els) => els.length)) === 2, 'each done criterion shows ✓ with its evidence');
  const diff = await win.textContent('[data-testid=step-tool-diff]');
  assert(diff.includes('명령어 /review') && diff.includes('커넥터 Gmail'), `tools that differ from the plan are flagged (${diff})`);
  assert(await win.isVisible('[data-testid=step-plan-changed]'), 'a result made with an older plan is marked');
  await win.click('[data-testid=step-accept]');
  assert((await step('A')).status === 'done', 'accepting the review completes the step');
  assert((await win.textContent('[data-testid=workflow-progress]')) === '1/3', 'progress counts it');

  // ── 다시 열기
  await win.waitForFunction(() => window.__tf.getState().saveState === 'saved');
  const file = await win.evaluate(() => window.__tf.getState().filePath);
  const saved = JSON.parse(readFileSync(file, 'utf-8'));
  assert(saved.version === 4 && saved.nodes.find((n) => n.id === 'A').step.resources.subagent.type === 'Explore' && saved.workflow.goal === '로그인 기능 만들기', 'the file keeps the plan (format v4)');
  await win.screenshot({ path: 'e2e/out/phase27-plan.png' });
  await shutdown(app);
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 4);
  assert((await boxStatus('A')) === 'done' && (await boxStatus('B')) === 'running' && (await boxStatus('C')) === 'todo', 'statuses come back after restart');
  await open('B');
  await win.waitForSelector('[data-testid=step-props]');
  assert((await win.getAttribute('[data-testid=step-props]', 'data-status')) === 'running', 'the panel shows the step again');
  console.log('PHASE 27 OK');
} finally {
  await shutdown(app);
}
