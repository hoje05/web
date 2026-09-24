import { launch, state, drag, assert, toScreen } from './harness.mjs';

const { app, win } = await launch();
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
const routeGeom = (id) =>
  win.evaluate((id) => {
    const el = document.querySelector(`[data-edge-id="${id}"] .route-line`);
    const L = el.getTotalLength();
    const pts = Array.from({ length: 41 }, (_, i) => el.getPointAtLength((L * i) / 40));
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }, id);
/** 곡선의 "모양 지표": chord 대비 최대 이탈 비율 (닮음 변환에 불변) */
const bulge = (pts) => {
  const a = pts[0], b = pts[pts.length - 1];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L);
  return m / L;
};

try {
  await win.click('[data-testid=tool-route]');
  // 큰 아치 + 손떨림 지그재그
  const path = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    path.push({
      x: 300 + t * 520,
      y: 520 - Math.sin(Math.PI * t) * 200 + Math.sin(t * 46 * Math.PI) * 9 + (i % 3) * 2,
    });
  }
  await drag(win, path[0], path[path.length - 1], { path });
  let s = await state(win);
  const e = Object.values(s.doc.edges)[0];
  assert(e.pathMode === 'freehand', 'curved drag is kept as freehand');
  assert(e.pathPoints.length > 20, `freehand keeps sampled points (${e.pathPoints.length})`);
  assert(Object.keys(s.doc.nodes).length === 2, 'free route created two boxes');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');

  // 선택 → 보정 전 스크린샷
  const onLine = await pointOnRoute(e.id, 0.3);
  await win.mouse.click(onLine.x, onLine.y);
  s = await state(win);
  assert(s.selection?.id === e.id, 'route selected by click');
  assert(await win.isEnabled('[data-testid=tool-correct]'), '보정 button enabled for curved route');
  await win.screenshot({ path: 'e2e/out/phase6-before.png' });
  const beforeGeom = await routeGeom(e.id);

  await win.click('[data-testid=tool-correct]');
  s = await state(win);
  const c = s.doc.edges[e.id];
  assert(c.pathMode === 'smoothed', 'pathMode becomes smoothed');
  assert(c.pathPoints.length < e.pathPoints.length / 3, `points reduced ${e.pathPoints.length} → ${c.pathPoints.length}`);
  assert(
    c.sourceNodeId === e.sourceNodeId && c.targetNodeId === e.targetNodeId &&
      c.sourceAnchor.side === e.sourceAnchor.side && c.targetAnchor.side === e.targetAnchor.side,
    'connections, anchors and direction preserved',
  );
  const afterGeom = await routeGeom(e.id);
  assert(Math.abs(bulge(afterGeom) - bulge(beforeGeom)) < 0.08, `big curve kept (bulge ${bulge(beforeGeom).toFixed(2)} → ${bulge(afterGeom).toFixed(2)})`);
  assert(afterGeom[0].x === beforeGeom[0].x && afterGeom[40].y === beforeGeom[40].y, 'start and end points unchanged');
  await win.screenshot({ path: 'e2e/out/phase6-after.png' });

  // 거의 곧은 드래그 → 직선
  await win.click('[data-testid=tool-route]');
  const straightPath = Array.from({ length: 30 }, (_, i) => ({ x: 300 + i * 12, y: 680 + Math.sin(i / 4) * 3 }));
  await drag(win, straightPath[0], straightPath[29], { path: straightPath });
  s = await state(win);
  const st = Object.values(s.doc.edges).find((x) => x.id !== e.id);
  assert(st.pathMode === 'straight', 'nearly straight drag becomes a straight route');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');

  // Phase 8: 곡선 Route가 연결된 Box 이동 → 끝점은 따라가고 곡선 모양은 유지
  s = await state(win);
  const tgt = s.doc.nodes[c.targetNodeId];
  const before = await routeGeom(e.id);
  const center = await toScreen(win, { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height / 2 });
  await drag(win, center, { x: center.x + 60, y: center.y + 90 }, { steps: 15 });
  s = await state(win);
  const moved = s.doc.nodes[c.targetNodeId];
  assert(moved.x !== tgt.x, 'target box moved');
  const after = await routeGeom(e.id);
  const endGap = Math.hypot(after[40].x - before[40].x - 60, after[40].y - before[40].y - 90);
  assert(endGap < 30, `route end follows the box (gap ${endGap.toFixed(1)})`);
  assert(Math.abs(after[0].x - before[0].x) < 0.5 && Math.abs(after[0].y - before[0].y) < 0.5, 'route start stays');
  assert(Math.abs(bulge(after) - bulge(before)) < 0.03, `relative curve shape preserved (${bulge(before).toFixed(3)} → ${bulge(after).toFixed(3)})`);
  assert(s.doc.edges[e.id].pathMode === 'smoothed', 'curve not replaced by straight line');
  await win.screenshot({ path: 'e2e/out/phase8-moved.png' });
  console.log('PHASE 6-8 OK');
} finally {
  await app.close();
}
