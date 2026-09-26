// Route 자동 보정, Box 이동에 따른 자동 재연결, 우클릭 삭제
import { launch, state, drag, assert, toScreen, shutdown } from './harness.mjs';

const { app, win } = await launch();
const routeSamples = (id) =>
  win.evaluate((id) => {
    const el = document.querySelector(`[data-edge-id="${id}"] .route-line`);
    const L = el.getTotalLength();
    return Array.from({ length: 81 }, (_, i) => {
      const p = el.getPointAtLength((L * i) / 80);
      return { x: p.x, y: p.y };
    });
  }, id);
/** 곡선의 불룩한 정도: chord 대비 최대 이탈 비율 */
const bulge = (pts) => {
  const a = pts[0], b = pts[pts.length - 1];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L);
  return m / L;
};
/** 세로 방향이 바뀌는 횟수 (지그재그면 많다) */
const wiggles = (pts) => {
  let n = 0, prev = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.sign(Math.round(pts[i].y - pts[i - 1].y));
    if (d && prev && d !== prev) n++;
    if (d) prev = d;
  }
  return n;
};
const pointOnRoute = (id, frac) =>
  win.evaluate(
    ([id, frac]) => {
      const el = document.querySelector(`[data-edge-id="${id}"] .route-line`);
      const p = el.getPointAtLength(el.getTotalLength() * frac);
      const m = el.getScreenCTM();
      return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
    },
    [id, frac],
  );

try {
  assert((await win.$$('[data-testid=tool-correct]')).length === 0, '보정 button removed from the toolbar');

  // 1) 흔들리는 아치를 그리면 → 바로 매끈한 곡선 (자동 보정)
  await win.click('[data-testid=tool-route]');
  const path = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    path.push({ x: 300 + t * 520, y: 520 - Math.sin(Math.PI * t) * 200 + Math.sin(t * 46 * Math.PI) * 9 + (i % 3) * 2 });
  }
  await drag(win, path[0], path[path.length - 1], { path });
  let s = await state(win);
  const e = Object.values(s.doc.edges)[0];
  assert(e.pathMode === 'smoothed' && e.pathPoints.length <= 12, `drawn curve is auto-corrected (${e.pathPoints.length} key points)`);
  const drawn = await routeSamples(e.id);
  assert(wiggles(drawn) <= 2, `no zigzag left (${wiggles(drawn)} turns)`);
  assert(bulge(drawn) > 0.25, `the big arch is kept (bulge ${bulge(drawn).toFixed(2)})`);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await win.screenshot({ path: 'e2e/out/phase6-before.png' });

  // 2) 거의 곧게 그으면 → 자동 연결선
  await win.click('[data-testid=tool-route]');
  const straightPath = Array.from({ length: 30 }, (_, i) => ({ x: 300 + i * 12, y: 680 + Math.sin(i / 4) * 3 }));
  await drag(win, straightPath[0], straightPath[29], { path: straightPath });
  s = await state(win);
  const st = Object.values(s.doc.edges).find((x) => x.id !== e.id);
  assert(st.pathMode === 'auto', 'nearly straight drag becomes an auto connector');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');

  // 3) Box를 옮기면 Route가 새 위치에 맞게 다시 이어진다
  s = await state(win);
  const src = s.doc.nodes[e.sourceNodeId];
  const tgt = s.doc.nodes[e.targetNodeId];
  // 도착 Box를 출발 Box 바로 아래로
  const from = await toScreen(win, { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height / 2 });
  const to = await toScreen(win, { x: src.x + src.width / 2 + 30, y: src.y + src.height / 2 + 190 });
  await drag(win, from, to, { steps: 20 });
  s = await state(win);
  const moved = s.doc.edges[e.id];
  assert(moved.pathMode === 'auto', 'after moving a box the drawn curve becomes an auto connector');
  assert(moved.sourceAnchor.side === 'bottom' && moved.targetAnchor.side === 'top',
    `connection sides follow the new position (${moved.sourceAnchor.side} → ${moved.targetAnchor.side})`);
  const after = await routeSamples(e.id);
  const a2 = s.doc.nodes[e.sourceNodeId], b2 = s.doc.nodes[e.targetNodeId];
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1.5;
  assert(near(after[0], { x: a2.x + a2.width / 2, y: a2.y + a2.height }) && near(after[80], { x: b2.x + b2.width / 2, y: b2.y }),
    'route starts at the bottom of the upper box and ends at the top of the lower box');
  assert(wiggles(after) <= 1 && after.every((p, i) => i === 0 || p.y >= after[i - 1].y - 0.5), 'route flows smoothly downward');
  await win.screenshot({ path: 'e2e/out/phase8-moved.png' });

  // 옆으로 옮기면 면도 옆으로
  const from2 = await toScreen(win, { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 });
  await drag(win, from2, { x: from2.x + 380, y: from2.y - 190 }, { steps: 20 });
  s = await state(win);
  assert(s.doc.edges[e.id].sourceAnchor.side === 'right' && s.doc.edges[e.id].targetAnchor.side === 'left', 'moving beside switches to right → left');

  // 4) 우클릭 → 삭제 (Route)
  const onLine = await pointOnRoute(st.id, 0.3);
  await win.mouse.click(onLine.x, onLine.y, { button: 'right' });
  await win.waitForSelector('[data-testid=context-menu]');
  assert((await win.textContent('[data-testid=context-delete]')).includes('Route 삭제'), 'right-click on a route shows “Route 삭제”');
  await win.screenshot({ path: 'e2e/out/phase6-context.png' });
  await win.click('[data-testid=context-delete]');
  s = await state(win);
  assert(!s.doc.edges[st.id] && !(await win.isVisible('[data-testid=context-menu]')), 'route deleted and menu closed');

  // 우클릭 → 삭제 (Box, 연결된 Route도 함께)
  const box = s.doc.nodes[e.sourceNodeId];
  const bc = await toScreen(win, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await win.mouse.click(bc.x, bc.y, { button: 'right' });
  assert((await win.textContent('[data-testid=context-delete]')).includes('Box 삭제'), 'right-click on a box shows “Box 삭제”');
  await win.click('[data-testid=context-delete]');
  s = await state(win);
  assert(!s.doc.nodes[box.id] && !s.doc.edges[e.id], 'box deleted together with its routes');
  await win.keyboard.press('Control+z');
  s = await state(win);
  assert(s.doc.nodes[box.id] && s.doc.edges[e.id], 'Ctrl+Z brings them back');

  // 빈 곳 우클릭 / Esc → 메뉴 없음·닫힘
  await win.mouse.click(1100, 150, { button: 'right' });
  assert(!(await win.isVisible('[data-testid=context-menu]')), 'right-click on empty space shows no menu');
  await win.mouse.click(bc.x, bc.y, { button: 'right' });
  await win.keyboard.press('Escape');
  assert(!(await win.isVisible('[data-testid=context-menu]')), 'Esc closes the menu');
  console.log('PHASE 6-8 OK');
} finally {
  await shutdown(app);
}
