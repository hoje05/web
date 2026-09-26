// 왼쪽 창(Box별 생각), 탭, Ctrl+F 검색, 자동 저장, 검은색 테마
import { launch, state, drag, assert, toScreen, shutdown } from './harness.mjs';
import { readFileSync, rmSync } from 'node:fs';

const { app, win, sandbox } = await launch([], { autoPanel: true });
const node = async (text) => Object.values((await state(win)).doc.nodes).find((n) => n.text === text);
const center = async (text) => {
  const n = await node(text);
  return toScreen(win, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
};
const clickBox = async (text) => {
  const c = await center(text);
  await win.mouse.click(c.x, c.y);
};
const box = async (x, y, text) => {
  await win.mouse.dblclick(x, y);
  await win.keyboard.type(text);
  await win.keyboard.press('Escape');
};
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });

try {
  // 검은색 테마
  const bg = await win.evaluate(() => getComputedStyle(document.querySelector('[data-testid=board]')).backgroundColor);
  assert(bg === 'rgb(14, 15, 17)', `dark board background (${bg})`);

  // Box 세 개 + 흐름 A → B → C
  await box(600, 250, '문제 발견');
  await box(950, 250, '실험해 봄');
  await box(950, 520, '결과 정리');
  const border = async (text, side) => {
    const n = await node(text);
    return toScreen(win, side === 'right' ? { x: n.x + n.width - 2, y: n.y + n.height / 2 } : { x: n.x + n.width / 2, y: n.y + n.height - 2 });
  };
  await drag(win, await border('문제 발견', 'right'), await center('실험해 봄'), { steps: 15 });
  await drag(win, await border('실험해 봄', 'bottom'), await center('결과 정리'), { steps: 15 });
  await win.keyboard.press('Escape');

  // 1) Box 클릭 → 왼쪽 창이 열리고 그 Box의 생각
  const before = await center('실험해 봄');
  await clickBox('실험해 봄');
  let s = await state(win);
  assert(s.panelOpen && s.activeTab === (await node('실험해 봄')).id, 'clicking a box opens the left panel for it');
  assert(await win.isVisible('[data-testid=side-panel]'), 'panel visible');
  const after = await center('실험해 봄');
  assert(Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, 'board content does not jump when the panel opens');
  assert((await win.inputValue('[data-testid=panel-title]')) === '실험해 봄', 'panel title shows the box text');
  assert((await win.textContent('.panel-flow')).includes('문제 발견') && (await win.textContent('.panel-flow')).includes('결과 정리'),
    'panel shows incoming/outgoing flow');

  // 2) 메모 쓰기 → 자동 저장
  await win.click('[data-testid=panel-note]');
  await win.keyboard.type('A/B 테스트로 버튼 색을 바꿔 봤다.\n전환율이 조금 올랐다.');
  await win.keyboard.press('Escape');
  await waitSaved();
  s = await state(win);
  const file = s.filePath;
  const saved = JSON.parse(readFileSync(file, 'utf-8'));
  assert(saved.nodes.find((n) => n.text === '실험해 봄').note.includes('전환율이 조금 올랐다'), 'note is autosaved to the file');
  assert(await win.isVisible('[data-node-id] .box-note-mark'), 'box shows a note mark');

  // 메모 편집은 Undo 한 번으로
  await win.keyboard.press('Control+z');
  assert((await node('실험해 봄')).note === '', 'one undo reverts the whole note session');
  await win.keyboard.press('Control+y');
  assert((await node('실험해 봄')).note.includes('A/B'), 'redo restores the note');

  // 창에서 제목을 고치면 Box도 바뀜
  await win.click('[data-testid=panel-title]');
  await win.keyboard.press('End');
  await win.keyboard.type(' (1차)');
  await win.keyboard.press('Escape');
  assert(await node('실험해 봄 (1차)'), 'editing the title in the panel updates the box');

  // 3) 탭: 다른 Box 클릭 → 탭이 한 줄로 늘어남, 탭 클릭으로 전환
  await clickBox('문제 발견');
  await clickBox('결과 정리');
  s = await state(win);
  const labels = await win.$$eval('[data-testid=panel-tab] .panel-tab-label', (els) => els.map((e) => e.textContent));
  assert(JSON.stringify(labels) === JSON.stringify(['실험해 봄 (1차)', '문제 발견', '결과 정리']), `tabs in a row: ${labels.join(' | ')}`);
  assert(s.activeTab === (await node('결과 정리')).id, 'last clicked box is the active tab');
  await win.click('[data-testid=panel-tab]:has-text("실험해 봄")');
  s = await state(win);
  assert(s.activeTab === (await node('실험해 봄 (1차)')).id && s.selection?.id === s.activeTab, 'clicking a tab switches the page and selects the box');
  assert((await win.inputValue('[data-testid=panel-note]')).includes('A/B'), 'switched page shows its note');

  // 흐름 칩으로 이동
  await win.click('.flow-chip.flow-out');
  assert((await state(win)).activeTab === (await node('결과 정리')).id, 'flow chip opens the next thought');

  // 탭 닫기
  await win.click('[data-testid=panel-tab]:has-text("문제 발견") .panel-tab-close');
  assert((await state(win)).tabs.length === 2, 'tab × closes that tab');

  // 4) 창 닫기 → 클릭으로는 안 열림 → 더블클릭으로 다시 열림
  await win.click('[data-testid=panel-close]');
  assert(!(await state(win)).panelOpen, 'panel closed');
  await clickBox('문제 발견');
  assert(!(await state(win)).panelOpen, 'single click does not reopen a closed panel');
  const c = await center('문제 발견');
  await win.mouse.dblclick(c.x, c.y);
  s = await state(win);
  assert(s.panelOpen && s.activeTab === (await node('문제 발견')).id, 'double-click reopens the panel on that box');
  assert(await win.evaluate(() => document.activeElement?.dataset.testid === 'panel-note'), 'double-click puts the cursor in the note');
  await win.keyboard.type('사용자 인터뷰에서 버튼이 안 보인다는 말이 반복됨');
  await win.keyboard.press('Escape');

  // 5) Ctrl+F 검색
  await win.keyboard.press('Control+f');
  assert(await win.isVisible('[data-testid=search-input]'), 'Ctrl+F opens search');
  await win.keyboard.type('버튼');
  const results = await win.$$eval('[data-testid=search-result] .search-result-title', (els) => els.map((e) => e.textContent));
  assert(results.length === 2 && results.includes('문제 발견') && results.includes('실험해 봄 (1차)'), `results = boxes whose note/title contain 버튼 (${results.join(', ')})`);
  const cls = await win.$$eval('[data-testid=box]', (els) => els.map((e) => e.className));
  assert(cls.filter((c) => c.includes('is-search-match')).length === 2 && cls.filter((c) => c.includes('is-search-dim')).length === 1,
    'matching boxes highlighted, others dimmed on the board');
  await win.click('[data-testid=search-result]:has-text("실험해 봄")');
  s = await state(win);
  assert(s.activeTab === (await node('실험해 봄 (1차)')).id, 'clicking a result opens that page');
  assert((await win.$$eval('.panel-note-backdrop mark', (m) => m.map((x) => x.textContent))).join() === '버튼', 'keyword highlighted inside the note');
  assert((await win.$$eval('.panel-tab.is-match', (t) => t.length)) >= 1, 'matching tabs marked');
  await win.screenshot({ path: 'e2e/out/phase14-search.png' });
  await win.click('[data-testid=search-input]');
  await win.keyboard.press('Escape');
  assert(!(await win.isVisible('[data-testid=search-bar]')), 'Esc closes search');
  assert((await win.$$eval('.is-search-dim', (e) => e.length)) === 0, 'highlights cleared after closing search');

  // 6) Ctrl+S는 창에서 글을 쓰는 중에도 즉시 저장
  await win.click('[data-testid=panel-note]');
  await win.keyboard.press('End');
  await win.keyboard.type(' 추가 메모');
  await win.keyboard.press('Control+s');
  await win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });
  const now = JSON.parse(readFileSync(file, 'utf-8'));
  assert(now.nodes.some((n) => n.note.endsWith('추가 메모')), 'Ctrl+S while typing saves immediately');

  // 7) 창 너비 조절
  const w0 = await win.evaluate(() => window.__tf.getState().panelWidth);
  const handle = await win.locator('.panel-resize').boundingBox();
  await drag(win, { x: handle.x + 4, y: 400 }, { x: handle.x + 124, y: 400 }, { steps: 6 });
  const w1 = await win.evaluate(() => window.__tf.getState().panelWidth);
  assert(w1 - w0 > 100, `panel resizable (${w0} → ${w1})`);

  await win.click('[data-testid=board]', { position: { x: 700, y: 700 } });
  await win.screenshot({ path: 'e2e/out/phase14-panel.png' });
  console.log('PHASE 14 OK');
} finally {
  await shutdown(app);
  rmSync(sandbox.dir, { recursive: true, force: true });
}
