import { launch, state, drag, assert, toScreen, shutdown } from './harness.mjs';

const { app, win } = await launch();
const box = async (x, y, text) => {
  await win.mouse.dblclick(x, y);
  await win.keyboard.type(text);
  await win.keyboard.press('Escape');
  return Object.values((await state(win)).doc.nodes).find((n) => n.text === text);
};
const center = (n) => toScreen(win, { x: n.x + n.width / 2, y: n.y + n.height / 2 });

try {
  const A = await box(250, 300, 'A');
  const C = await box(950, 300, 'C');
  await drag(win, await toScreen(win, { x: A.x + A.width - 2, y: A.y + A.height / 2 }), await center(C), { steps: 20 });
  let s = await state(win);
  const e = Object.values(s.doc.edges)[0];
  assert(e.pathMode === 'straight', 'horizontal straight route');

  // 1) 완전한 수평선에서도 glow가 보여야 함 (filter 영역 높이 > 0)
  await win.mouse.click((await center(A)).x, (await center(A)).y);
  const f = await win.evaluate((id) => {
    const filter = document.querySelector(`[data-edge-id="${id}"] filter`);
    return filter && { h: +filter.getAttribute('height'), w: +filter.getAttribute('width') };
  }, e.id);
  assert(f && f.h > 10 && f.w > 100, `glow filter region covers a horizontal line (${f && f.w}×${f && f.h})`);

  // 2) 다른 Box가 Route 중앙을 가리면 화살표가 보이는 곳으로 이동
  const B = await box(600, 600, 'B 가리는 Box');
  const bc = await center(B);
  const mid = await win.evaluate((id) => {
    const r = document.querySelector(`[data-edge-id="${id}"] .route-arrow`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, e.id);
  await drag(win, bc, { x: mid.x, y: mid.y }, { steps: 20 });
  s = await state(win);
  const Bn = s.doc.nodes[B.id];
  const arrow = await win.evaluate((id) => {
    const r = document.querySelector(`[data-edge-id="${id}"] .route-arrow`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, e.id);
  const tl = await toScreen(win, { x: Bn.x, y: Bn.y });
  const br = await toScreen(win, { x: Bn.x + Bn.width, y: Bn.y + Bn.height });
  const hidden = arrow.x > tl.x && arrow.x < br.x && arrow.y > tl.y && arrow.y < br.y;
  assert(!hidden, 'arrow moved out from under the covering box');

  // 3) 드래그한 Box는 맨 위로
  const order = Object.keys(s.doc.nodes);
  assert(order[order.length - 1] === B.id, 'dragged box brought to front');
  await win.mouse.click((await center(A)).x, (await center(A)).y); // A 선택
  const ac = await center(s.doc.nodes[A.id]);
  await drag(win, ac, { x: ac.x + 5, y: ac.y + 5 }, { steps: 5 });
  assert(Object.keys((await state(win)).doc.nodes).pop() === A.id, 'another drag brings that box to front');

  // 4) 툴바 버튼이 포커스를 가져가지 않음 → Space가 Route 도구를 토글하지 않음
  await win.click('[data-testid=tool-route]');
  assert((await state(win)).tool === 'route', 'route tool on');
  await win.keyboard.down('Space');
  await win.keyboard.up('Space');
  assert((await state(win)).tool === 'route', 'Space does not re-trigger the toolbar button');
  await win.keyboard.press('Escape');

  // 5) 전체 보기: 멀리 이동한 뒤에도 모든 Box가 화면 안에
  await drag(win, { x: 640, y: 740 }, { x: 1200, y: 100 }, { steps: 10 });
  await win.keyboard.press('Shift+Digit1');
  s = await state(win);
  const size = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  for (const n of Object.values(s.doc.nodes)) {
    const p1 = await toScreen(win, { x: n.x, y: n.y });
    const p2 = await toScreen(win, { x: n.x + n.width, y: n.y + n.height });
    assert(p1.x >= 0 && p1.y >= 0 && p2.x <= size.w && p2.y <= size.h, `box "${n.text}" visible after fit`);
  }

  // 6) 도움말 패널
  await win.click('button[title="사용법"]');
  assert(await win.isVisible('.help-panel'), 'help panel opens');
  await win.keyboard.press('Escape');
  assert(!(await win.isVisible('.help-panel')), 'Esc closes help panel');
  console.log('PHASE 13 OK');
} finally {
  await shutdown(app);
}
