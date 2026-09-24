import { launch, state, drag, assert, toScreen, shutdown } from './harness.mjs';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tflow-'));
const file = join(dir, '내 생각.tflow');

let { app, win } = await launch();
const mockDialogs = (a, { save, open, messageBox, messageBoxSync }) =>
  a.evaluate(({ dialog }, m) => {
    if (m.save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: m.save });
    if (m.open) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [m.open] });
    if (m.messageBox !== undefined) dialog.showMessageBox = async () => ({ response: m.messageBox, checkboxChecked: false });
    if (m.messageBoxSync !== undefined) dialog.showMessageBoxSync = () => m.messageBoxSync;
  }, { save, open, messageBox, messageBoxSync });
const center = (n) => toScreen(win, { x: n.x + n.width / 2, y: n.y + n.height / 2 });

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
  assert((await win.title()).includes('•'), 'title shows unsaved marker');

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

  // 방향 반전 Undo
  s.doc.edges[e.id];
  await win.evaluate((id) => window.__tf.getState().reverseEdge(id), e.id);
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.edges[e.id].sourceNodeId === A.id, 'undo direction reverse');

  // Box 이동 Undo (드래그 한 번 = Undo 한 번)
  const pastBefore = s.past;
  const c = await center(A);
  await drag(win, c, { x: c.x - 40, y: c.y + 120 }, { steps: 25 });
  s = await state(win);
  assert(s.past === pastBefore + 1, 'one drag = one undo step');
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.nodes[A.id].x === A.x && s.doc.nodes[A.id].y === A.y, 'undo box move');
  await win.keyboard.press('Control+y');
  s = await state(win);
  assert(s.doc.nodes[A.id].y !== A.y, 'Ctrl+Y redoes box move');

  // 텍스트 변경 Undo
  await win.mouse.dblclick((await center(s.doc.nodes[A.id])).x, (await center(s.doc.nodes[A.id])).y);
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

  // ── 저장
  await mockDialogs(app, { save: file });
  await win.keyboard.press('Control+s');
  await win.waitForFunction(() => !document.title.includes('•'));
  assert(existsSync(file), 'file written');
  const saved = await state(win);
  assert(saved.filePath === file && !saved.dirty, 'saved: path remembered, not dirty');
  assert((await win.title()).startsWith('내 생각.tflow'), `title shows file name (${await win.title()})`);
  const json = JSON.parse(readFileSync(file, 'utf-8'));
  assert(json.nodes.length === 2 && json.edges.length === 1 && json.board.zoom === saved.viewport.zoom, 'file contains board data');

  // Undo로 저장 시점으로 돌아오면 dirty 해제
  await win.keyboard.press('Delete'); // 아무것도 선택 안 됐을 수도 있으니 확실히 변경
  await win.mouse.dblclick(900, 650);
  await win.keyboard.press('Escape');
  assert((await state(win)).dirty, 'change after save → dirty');
  await win.keyboard.press('Control+z');
  assert(!(await state(win)).dirty, 'undo back to saved state → clean again');

  // ── 새 보드 (변경 있으면 확인 → 저장 안 함)
  await win.mouse.dblclick(900, 650);
  await win.keyboard.press('Escape');
  await mockDialogs(app, { messageBox: 1 });
  await win.keyboard.press('Control+n');
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 0);
  assert((await state(win)).filePath === null, 'new board after discarding changes');

  // ── 열기
  await mockDialogs(app, { open: file });
  await win.keyboard.press('Control+o');
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 2);
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
  const loaded = s;
  assert(s.doc.nodes[A.id].text === saved.doc.nodes[A.id].text, 'texts restored');
  assert(s.viewport.zoom === saved.viewport.zoom && s.viewport.panX === saved.viewport.panX, 'viewport restored');
  assert(!s.dirty && s.past === 0, 'opened board is clean with empty history');

  // ── 닫기: 변경 있음 → 취소하면 안 닫힘
  await win.mouse.dblclick(900, 650);
  await win.keyboard.press('Escape');
  await mockDialogs(app, { messageBoxSync: 2 });
  // 창의 X 버튼과 같은 경로
  const clickCloseButton = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await clickCloseButton();
  await win.waitForTimeout(300);
  assert(!win.isClosed(), 'close cancelled when user picks 취소');
  // 저장 안 함 → 닫힘
  await mockDialogs(app, { messageBoxSync: 1 });
  const closed = app.waitForEvent('close');
  await clickCloseButton();
  await closed;
  assert(true, 'close proceeds when user picks 저장 안 함');

  // ── 프로그램 재실행 + 파일 경로 인자로 열기 → 같은 보드 복원
  ({ app, win } = await launch([file]));
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 2);
  s = await state(win);
  assert(JSON.stringify(s.doc) === JSON.stringify(loaded.doc), 'relaunch with file restores the identical board');
  await win.screenshot({ path: 'e2e/out/phase12-reopened.png' });

  // 닫기 → "저장" 선택 → 저장 후 닫힘
  await win.mouse.dblclick(1000, 200);
  await win.keyboard.type('닫기 전 추가');
  await win.keyboard.press('Escape');
  await mockDialogs(app, { messageBoxSync: 0 });
  const closed2 = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed2;
  const after = JSON.parse(readFileSync(file, 'utf-8'));
  assert(after.nodes.some((n) => n.text === '닫기 전 추가'), 'choosing 저장 on close saves the file and closes');
  console.log('PHASE 11-12 OK');
} finally {
  await shutdown(app);
  rmSync(dir, { recursive: true, force: true });
}
