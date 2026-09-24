import { launch, state, drag, assert, toScreen } from './harness.mjs';

const { app, win } = await launch();
try {
  // 1) Toolbar Box를 끌어다 놓기
  const tb = await win.locator('[data-testid=tool-box]').boundingBox();
  await drag(win, { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }, { x: 500, y: 300 });
  let s = await state(win);
  const ids = Object.keys(s.doc.nodes);
  assert(ids.length === 1, 'toolbar drag creates one box');
  assert(s.editingNodeId === ids[0], 'new box enters edit mode');

  // 2) 한글 입력 + 줄바꿈 후 Esc
  await win.keyboard.type('처음 생각');
  await win.keyboard.press('Enter');
  await win.keyboard.type('두 번째 줄');
  await win.keyboard.press('Escape');
  s = await state(win);
  assert(s.doc.nodes[ids[0]].text === '처음 생각\n두 번째 줄', 'text committed: ' + JSON.stringify(s.doc.nodes[ids[0]].text));
  assert(s.editingNodeId === null, 'escape ends editing');
  assert(s.doc.nodes[ids[0]].height > 64, 'box grew with text (h=' + s.doc.nodes[ids[0]].height + ')');

  // 3) 빈 곳 더블클릭 → 새 Box
  await win.mouse.dblclick(850, 500);
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 2, 'double-click creates box');
  await win.keyboard.type('Second');
  await win.mouse.click(700, 650); // 바깥 클릭으로 편집 종료
  s = await state(win);
  const second = Object.values(s.doc.nodes).find((n) => n.text === 'Second');
  assert(second, 'click outside commits text');
  assert(s.selection === null, 'click on empty clears selection');

  // 4) Box 이동
  const n0 = s.doc.nodes[ids[0]];
  const c = await toScreen(win, { x: n0.x + n0.width / 2, y: n0.y + n0.height / 2 });
  await drag(win, c, { x: c.x + 100, y: c.y + 60 });
  s = await state(win);
  const moved = s.doc.nodes[ids[0]];
  assert(Math.abs(moved.x - n0.x - 100) <= 1 && Math.abs(moved.y - n0.y - 60) <= 1, 'drag moves box by (100,60)');
  assert(s.selection?.id === ids[0], 'dragged box is selected');

  // 5) 더블클릭 → 편집, Enter로 편집
  await win.keyboard.press('Enter');
  s = await state(win);
  assert(s.editingNodeId === ids[0], 'Enter starts editing selected box');
  await win.keyboard.press('Escape');

  // 6) Delete
  await win.keyboard.press('Delete');
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 1 && !s.doc.nodes[ids[0]], 'Delete removes selected box');

  // 7) Toolbar Box 클릭 → 화면 중앙
  await win.click('[data-testid=tool-box]');
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 2, 'clicking Box button creates box at center');
  await win.keyboard.press('Escape');

  // 8) Pan (빈 곳 드래그)
  const v0 = (await state(win)).viewport;
  await drag(win, { x: 300, y: 650 }, { x: 380, y: 700 });
  const v1 = (await state(win)).viewport;
  assert(Math.abs(v1.panX - v0.panX - 80) < 1 && Math.abs(v1.panY - v0.panY - 50) < 1, 'empty drag pans board');

  await win.screenshot({ path: 'e2e/out/phase2.png' });
  console.log('PHASE 2 OK');
} finally {
  await app.close();
}
