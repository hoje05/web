import { launch, makeSandbox, state, drag, assert, toScreen, shutdown } from './harness.mjs';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const sandbox = makeSandbox();
const saveAsFile = join(sandbox.dir, '내 생각.tflow');
let { app, win } = await launch([], { sandbox });
const mockDialogs = (a, { save, open }) =>
  a.evaluate(({ dialog }, m) => {
    if (m.save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: m.save });
    if (m.open) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [m.open] });
  }, { save, open });
const center = (n) => toScreen(win, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });
const readBoard = (p) => JSON.parse(readFileSync(p, 'utf-8'));

try {
  // ── 보드 만들기: A → (곡선) → B
  await win.mouse.dblclick(350, 400);
  await win.keyboard.type('원인');
  await win.keyboard.press('Escape');
  let s = await state(win);
  const A = Object.values(s.doc.nodes)[0];
  const from = await toScreen(win, { x: A.x + A.width - 2, y: A.y + A.height / 2 });
  const path = Array.from({ length: 50 }, (_, i) => ({
    x: from.x + i * 9,
    y: from.y - Math.sin((Math.PI * i) / 49) * 140 + (i % 2) * 6,
  }));
  await drag(win, from, path[49], { path });
  await win.keyboard.type('결과');
  await win.keyboard.press('Escape');
  s = await state(win);
  const e = Object.values(s.doc.edges)[0];
  const B = s.doc.nodes[e.targetNodeId];
  assert(e.pathMode === 'freehand' && B.text === '결과', 'board with curved route A → B');

  // ── 자동 저장: 이름 없는 보드는 문서/ThoughtFlow(테스트에서는 임시 폴더)에 저절로 저장
  await waitSaved();
  s = await state(win);
  const autoFile = s.filePath;
  assert(autoFile && autoFile.startsWith(sandbox.boards) && /생각 흐름 .*\.tflow$/.test(autoFile), `autosaved to default folder (${autoFile})`);
  assert(readBoard(autoFile).nodes.some((n) => n.text === '결과'), 'autosaved file has latest text');
  assert((await win.title()).startsWith('생각 흐름'), `title shows file name (${await win.title()})`);
  assert((await win.textContent('[data-testid=save-status]')).includes('자동 저장됨'), 'save status shows 자동 저장됨');

  // 보정 → Undo → 원래 Raw Path
  await win.evaluate((id) => window.__tf.getState().select({ kind: 'edge', id }), e.id);
  await win.click('[data-testid=tool-correct]');
  s = await state(win);
  assert(s.doc.edges[e.id].pathMode === 'smoothed', 'route corrected');
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.edges[e.id].pathMode === 'freehand' && JSON.stringify(s.doc.edges[e.id].pathPoints) === JSON.stringify(e.pathPoints),
    'Ctrl+Z restores the exact raw path');
  await win.keyboard.press('Control+Shift+z');
  s = await state(win);
  assert(s.doc.edges[e.id].pathMode === 'smoothed', 'Ctrl+Shift+Z redoes correction');
  await waitSaved();
  assert(readBoard(autoFile).edges[0].pathMode === 'smoothed', 'correction autosaved');

  // 방향 반전 Undo
  await win.evaluate((id) => window.__tf.getState().reverseEdge(id), e.id);
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.edges[e.id].sourceNodeId === A.id, 'undo direction reverse');

  // Box 이동 Undo (드래그 한 번 = Undo 한 번) + 이동도 자동 저장
  const pastBefore = s.past;
  const c = await center(A);
  await drag(win, c, { x: c.x - 40, y: c.y + 120 }, { steps: 25 });
  s = await state(win);
  assert(s.past === pastBefore + 1, 'one drag = one undo step');
  await waitSaved();
  assert(readBoard(autoFile).nodes.find((n) => n.id === A.id).y === s.doc.nodes[A.id].y, 'box move autosaved');
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.nodes[A.id].x === A.x && s.doc.nodes[A.id].y === A.y, 'undo box move');
  await win.keyboard.press('Control+y');
  s = await state(win);
  assert(s.doc.nodes[A.id].y !== A.y, 'Ctrl+Y redoes box move');

  // 텍스트 변경 Undo (선택 후 Enter로 Box 안에서 편집)
  await win.mouse.click((await center(s.doc.nodes[A.id])).x, (await center(s.doc.nodes[A.id])).y);
  await win.keyboard.press('Enter');
  await win.keyboard.press('End');
  await win.keyboard.type(' 추가');
  await win.keyboard.press('Escape');
  assert((await state(win)).doc.nodes[A.id].text === '원인 추가', 'text edited');
  await win.keyboard.press('Control+z');
  assert((await state(win)).doc.nodes[A.id].text === '원인', 'undo text change');
  await win.keyboard.press('Control+y');

  // Box 삭제 Undo → 연결 Route까지 복원
  await win.evaluate((id) => window.__tf.getState().select({ kind: 'node', id }), A.id);
  await win.keyboard.press('Delete');
  s = await state(win);
  assert(!s.doc.nodes[A.id] && !s.doc.edges[e.id], 'box and its route deleted');
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.nodes[A.id] && s.doc.edges[e.id], 'undo restores box and route');
  await waitSaved();

  // ── Ctrl+S: 즉시 저장 (viewport까지)
  await win.keyboard.press('Control+=');
  await win.keyboard.press('Control+s');
  await win.waitForFunction(() => window.__tf.getState().saveState === 'saved');
  await win.waitForTimeout(150);
  const zoomNow = (await state(win)).viewport.zoom;
  assert(Math.abs(readBoard(autoFile).board.zoom - zoomNow) < 1e-3, 'Ctrl+S writes immediately (including zoom)');

  // ── 다른 이름으로 저장 → 이후 자동 저장도 새 파일로
  await mockDialogs(app, { save: saveAsFile });
  await win.keyboard.press('Control+Shift+s');
  await win.waitForFunction((p) => window.__tf.getState().filePath === p, saveAsFile);
  assert(existsSync(saveAsFile), 'save as writes the chosen file');
  await win.mouse.dblclick(900, 650);
  await win.keyboard.type('새 파일로');
  await win.keyboard.press('Escape');
  await waitSaved();
  assert(readBoard(saveAsFile).nodes.some((n) => n.text === '새 파일로'), 'autosave continues into the save-as file');
  const saved = await state(win);

  // ── 새 보드: 확인 없이 바로 (이미 저장되어 있으므로)
  await win.keyboard.press('Control+n');
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 0);
  assert((await state(win)).filePath === null, 'new board (no dialog needed)');
  await win.waitForTimeout(700);
  assert(readdirSync(sandbox.boards).length === 1, 'empty new board does not create a file');

  // ── 열기
  await mockDialogs(app, { open: saveAsFile });
  await win.keyboard.press('Control+o');
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 3);
  s = await state(win);
  const re = s.doc.edges[e.id];
  const se = saved.doc.edges[e.id];
  assert(
    re.sourceNodeId === se.sourceNodeId && re.targetNodeId === se.targetNodeId &&
      re.sourceAnchor.side === se.sourceAnchor.side && re.targetAnchor.side === se.targetAnchor.side &&
      re.pathMode === se.pathMode && re.pathPoints.length === se.pathPoints.length &&
      re.pathPoints.every(([u, v], i) => Math.abs(u - se.pathPoints[i][0]) < 1e-5 && Math.abs(v - se.pathPoints[i][1]) < 1e-5),
    'route restored (connections, anchors, mode, path within 1e-5)',
  );
  assert(s.doc.nodes[A.id].text === saved.doc.nodes[A.id].text, 'texts restored');
  assert(!s.dirty && s.past === 0, 'opened board is clean with empty history');

  // ── 닫기 직전 변경도 저장됨 (자동 저장 대기 시간 안에 닫아도)
  await win.mouse.dblclick(1000, 200);
  await win.keyboard.type('닫기 직전');
  await win.keyboard.press('Escape');
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  assert(readBoard(saveAsFile).nodes.some((n) => n.text === '닫기 직전'), 'closing flushes the last change to disk');
  const final = readBoard(saveAsFile);

  // ── 다시 실행하면 마지막 보드가 자동으로 열림
  ({ app, win } = await launch([], { sandbox }));
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 4);
  s = await state(win);
  assert(s.filePath === saveAsFile, 'relaunch reopens the last board');
  assert(Object.values(s.doc.nodes).map((n) => n.text).sort().join() === final.nodes.map((n) => n.text).sort().join(), 'same boxes restored');
  await shutdown(app);

  // ── 파일 경로를 인자로 실행 → 그 파일
  ({ app, win } = await launch([autoFile], { sandbox }));
  await win.waitForFunction((p) => window.__tf.getState().filePath === p, autoFile);
  assert(Object.keys((await state(win)).doc.nodes).length === 2, 'launching with a file argument opens that file');
  await win.screenshot({ path: 'e2e/out/phase12-reopened.png' });
  console.log('PHASE 11-12 OK');
} finally {
  await shutdown(app);
  rmSync(sandbox.dir, { recursive: true, force: true });
}
