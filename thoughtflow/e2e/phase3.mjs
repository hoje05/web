import { launch, state, drag, assert, toScreen } from './harness.mjs';

const { app, win } = await launch();
const nodeCenter = async (n) => toScreen(win, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
const rightBorder = async (n) => toScreen(win, { x: n.x + n.width - 3, y: n.y + n.height / 2 });
try {
  // 두 Box 준비
  await win.mouse.dblclick(400, 300);
  await win.keyboard.type('A');
  await win.keyboard.press('Escape');
  await win.mouse.dblclick(800, 320);
  await win.keyboard.type('B');
  await win.keyboard.press('Escape');
  let s = await state(win);
  const [A, B] = Object.values(s.doc.nodes);

  // Phase 3: A 테두리 → B 위에 놓기 = 연결 (새 Box 없음)
  await drag(win, await rightBorder(A), await nodeCenter(B), { steps: 20 });
  s = await state(win);
  let edges = Object.values(s.doc.edges);
  assert(edges.length === 1, 'border drag onto box creates a route');
  assert(Object.keys(s.doc.nodes).length === 2, 'no new box when dropped on existing box');
  const e1 = edges[0];
  assert(e1.sourceNodeId === A.id && e1.targetNodeId === B.id, 'direction follows drawing: A → B');
  assert(e1.sourceAnchor.side === 'right' && e1.targetAnchor.side === 'left', `anchors right→left (${e1.sourceAnchor.side}→${e1.targetAnchor.side})`);
  assert(s.selection?.kind === 'edge', 'new route is selected');

  // 화살표 클릭 → 반전
  const arrow = await win.evaluate((id) => {
    const el = document.querySelector(`[data-edge-id="${id}"] .route-arrow`);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, e1.id);
  await win.mouse.click(arrow.x, arrow.y);
  s = await state(win);
  const r1 = s.doc.edges[e1.id];
  assert(r1.sourceNodeId === B.id && r1.targetNodeId === A.id, 'arrow click reverses: B → A');
  assert(r1.sourceAnchor.side === 'left' && r1.targetAnchor.side === 'right', 'anchors swapped with direction');
  await win.mouse.click(arrow.x, arrow.y);
  s = await state(win);
  assert(s.doc.edges[e1.id].sourceNodeId === A.id, 'second click reverses back');

  // Phase 4: B 테두리에서 빈 곳으로 → 새 Box 자동 생성 + 입력 상태
  const Bn = s.doc.nodes[B.id];
  const from = await toScreen(win, { x: Bn.x + Bn.width / 2, y: Bn.y + Bn.height - 3 });
  await drag(win, from, { x: from.x + 10, y: from.y + 200 }, { steps: 20 });
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 3, 'border drag to empty creates new box');
  const C = Object.values(s.doc.nodes).find((n) => n.id !== A.id && n.id !== B.id);
  assert(s.editingNodeId === C.id, 'new box is in edit mode');
  const eBC = Object.values(s.doc.edges).find((e) => e.targetNodeId === C.id);
  assert(eBC && eBC.sourceNodeId === B.id, 'route B → C');
  assert(eBC.targetAnchor.side === 'top', 'new box entered from top (dragged downward)');
  // 새 Box의 top 중앙이 놓은 지점
  const released = { x: from.x + 10, y: from.y + 200 };
  const topCenter = await toScreen(win, { x: C.x + C.width / 2, y: C.y });
  assert(Math.hypot(topCenter.x - released.x, topCenter.y - released.y) < 3, 'new box placed so its entry side center is at release point');
  await win.keyboard.type('C');
  await win.keyboard.press('Escape');

  // 짧은 드래그는 Route를 만들지 않음
  const before = Object.keys((await state(win)).doc.edges).length;
  const An = (await state(win)).doc.nodes[A.id];
  const lb = await toScreen(win, { x: An.x + 2, y: An.y + An.height / 2 });
  await drag(win, lb, { x: lb.x - 8, y: lb.y }, { steps: 3 });
  assert(Object.keys((await state(win)).doc.edges).length === before, 'tiny drag does not create a route');

  // Phase 5: Route 도구로 빈 곳 → 빈 곳 = 양쪽 Box 생성
  await win.click('[data-testid=tool-route]');
  assert((await state(win)).tool === 'route', 'route tool active');
  await drag(win, { x: 300, y: 600 }, { x: 600, y: 620 }, { steps: 25 });
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 5, 'free route on empty board creates two boxes');
  const e5 = Object.values(s.doc.edges).find((e) => e.sourceNodeId !== A.id && e.sourceNodeId !== B.id && e.targetNodeId !== C.id);
  assert(e5 && s.editingNodeId === e5.sourceNodeId, 'source box of free route is in edit mode');
  await win.keyboard.type('Start');
  await win.keyboard.press('Tab');
  s = await state(win);
  assert(s.editingNodeId === e5.targetNodeId, 'Tab moves editing to the next (outgoing) box');
  await win.keyboard.type('End');
  await win.keyboard.press('Escape');
  s = await state(win);
  assert(s.doc.nodes[e5.sourceNodeId].text === 'Start' && s.doc.nodes[e5.targetNodeId].text === 'End', 'both texts committed via Tab flow');

  // Route 도구: 빈 곳 → 기존 Box = 시작 쪽만 새 Box
  const Cn = (await state(win)).doc.nodes[C.id];
  await drag(win, { x: 250, y: 450 }, await nodeCenter(Cn), { steps: 25 });
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 6, 'free route ending on existing box creates only the source box');
  const toC = Object.values(s.doc.edges).filter((e) => e.targetNodeId === C.id);
  assert(toC.length === 2, 'second route connects into C');
  await win.keyboard.press('Escape'); // 편집 종료
  await win.keyboard.press('Escape'); // Route 도구 해제
  assert((await state(win)).tool === 'select', 'Esc returns to select tool');

  // Route 클릭 → 선택, Delete로 삭제
  const g = await win.evaluate((id) => {
    const el = document.querySelector(`[data-edge-id="${id}"] .route-line`);
    const len = el.getTotalLength();
    const p = el.getPointAtLength(len * 0.25);
    const m = el.getScreenCTM();
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  }, eBC.id);
  await win.mouse.click(g.x, g.y + 4); // 선에서 4px 떨어져도 선택되어야 함
  s = await state(win);
  assert(s.selection?.kind === 'edge' && s.selection.id === eBC.id, 'clicking near a route selects it (wide hit area)');
  await win.screenshot({ path: 'e2e/out/phase3.png' });
  await win.keyboard.press('Delete');
  s = await state(win);
  assert(!s.doc.edges[eBC.id] && s.doc.nodes[C.id], 'Delete removes only the route');

  // Box 삭제 시 연결된 Route도 삭제
  await win.mouse.click((await nodeCenter(s.doc.nodes[A.id])).x, (await nodeCenter(s.doc.nodes[A.id])).y);
  await win.keyboard.press('Delete');
  s = await state(win);
  assert(!Object.values(s.doc.edges).some((e) => e.sourceNodeId === A.id || e.targetNodeId === A.id), 'deleting box removes its routes');
  console.log('PHASE 3-5 OK');
} finally {
  await app.close();
}
