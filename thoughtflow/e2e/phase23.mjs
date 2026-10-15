// 정렬 버튼 토글: → 나가는 흐름(기존 정렬) ↔ ← 들어오는 흐름 중심 (선택한 Box가 중심).
// Scenario 11–15: 나가는 정렬, 들어오는 정렬, 복잡한 들어오는 흐름, 순환, Undo. 정렬은 위치만 바꾼다.
import { assert, launch, shutdown } from './harness.mjs';

const { app, win } = await launch([]);
const doc = () => win.evaluate(() => window.__tf.getState().doc);
const dir = () => win.textContent('[data-testid=sort-dir]');
const message = () => win.evaluate(() => window.__tf.getState().aiActivity?.message ?? '');
const cx = (n) => n.x + n.width / 2;
const cy = (n) => n.y + n.height / 2;
const positions = (d) => JSON.stringify(Object.values(d.nodes).map((n) => [n.id, n.x, n.y]));
const settle = () => win.waitForTimeout(800);
/** 정렬 버튼 한 번 (움직임이 끝날 때까지) */
const press = async () => {
  const before = await win.evaluate(() => window.__tf.getState().aiActivity?.seq ?? 0);
  await win.click('[data-testid=tool-arrange]');
  await win.waitForFunction((b) => (window.__tf.getState().aiActivity?.seq ?? 0) > b, before);
  await settle();
};
const load = (nodes, edges, select) =>
  win.evaluate(
    ([nodes, edges, select]) => {
      const s = window.__tf.getState();
      const box = ([id, x, y]) => ({ id, x, y, width: 180, height: 56, text: id.toUpperCase(), note: '' });
      const route = ([a, b], i) => ({
        id: `r${i}`,
        sourceNodeId: a,
        targetNodeId: b,
        sourceAnchor: { side: 'bottom' },
        targetAnchor: { side: 'top' },
        pathPoints: [],
        pathMode: 'auto',
      });
      s.commit({ ...s.doc, nodes: Object.fromEntries(nodes.map((n) => [n[0], box(n)])), edges: Object.fromEntries(edges.map((e, i) => [`r${i}`, route(e, i)])) });
      s.select(select ? { kind: 'node', id: select } : null);
      s.fitView();
    },
    [nodes, edges, select],
  );

try {
  // ── Scenario 11: A → B → C, B 선택, 첫 번째 클릭 = 기존 나가는 흐름 정렬
  await load([['a', 600, 300], ['b', 0, 0], ['c', 300, 500]], [['a', 'b'], ['b', 'c']], 'b');
  await win.waitForTimeout(300);
  assert((await dir()) === '→', 'button shows → (outgoing) before the first press');
  const title = await win.getAttribute('[data-testid=tool-arrange]', 'title');
  assert(title.includes('Outgoing Flow'), 'tooltip names the mode');
  const orig11 = await doc();
  const past11 = await win.evaluate(() => window.__tf.getState().past.length);
  await press();
  let d = await doc();
  assert(cx(d.nodes.a) < cx(d.nodes.b) && cx(d.nodes.b) < cx(d.nodes.c) && cy(d.nodes.a) === cy(d.nodes.c), 'outgoing: A → B → C left to right in one row');
  assert((await message()).includes('흐름 순서대로 정렬했습니다'), 'notice: outgoing sort');
  const out11 = d;

  // ── Scenario 12: 같은 상태에서 다시 클릭 = 들어오는 흐름 중심 (B가 중심, A가 B로 들어온다)
  assert((await dir()) === '←', 'button now shows ← (incoming)');
  assert((await win.getAttribute('[data-testid=tool-arrange]', 'title')).includes('Incoming Flow'), 'tooltip: Incoming Flow');
  await press();
  d = await doc();
  assert(cx(d.nodes.a) < cx(d.nodes.b) && cy(d.nodes.a) === cy(d.nodes.b), 'incoming: A flows into B from the left, on B’s row');
  assert(/들어오는 흐름\(←\) 중심/.test(await message()), `notice: incoming sort (${await message()})`);
  assert((await dir()) === '→', 'third press would be → again');
  await press();
  d = await doc();
  assert(positions(d) === positions(out11), 'third press: outgoing again (same layout as the first press)');

  // ── Scenario 15: Ctrl+Z → 정렬 직전 위치로 (나가는/들어오는 정렬 모두)
  // (이미 정렬된 모양이면 Undo 기록을 남기지 않으므로, 정렬 전 기록 수까지 되돌린다)
  const steps = (await win.evaluate(() => window.__tf.getState().past.length)) - past11;
  assert(steps >= 1 && steps <= 3, `each sort that moved boxes is one undo step (${steps})`);
  for (let i = 0; i < steps; i++) await win.keyboard.press('Control+z');
  assert(positions(await doc()) === positions(orig11), 'Ctrl+Z restores every box to where it was before sorting');

  // ── Scenario 13: A→D, B→D, C→D, E→B. D를 선택하고 들어오는 흐름 정렬
  await load(
    [['a', 0, 0], ['b', 500, 500], ['c', 100, 700], ['d', 200, 300], ['e', 700, 100]],
    [['a', 'd'], ['b', 'd'], ['c', 'd'], ['e', 'b']],
    'd',
  );
  await win.waitForTimeout(300);
  const before13 = await doc();
  // 처음 누르면 →, 한 번 더 누르면 ←
  await press();
  assert((await dir()) === '←', 'second press will be incoming');
  const pastBefore = await win.evaluate(() => window.__tf.getState().past.length);
  await press();
  d = await doc();
  const n = d.nodes;
  assert(cx(n.a) === cx(n.b) && cx(n.b) === cx(n.c), 'A, B, C stand in one column (incoming boxes of D)');
  assert(cx(n.d) > cx(n.a), 'D is to their right (the center)');
  assert(cx(n.e) < cx(n.b) && cy(n.e) === cy(n.b), 'E → B sits one step further back, on B’s row');
  const ys = [n.a, n.b, n.c].map(cy).sort((p, q) => p - q);
  assert(cy(n.d) === ys[1], 'D sits in the middle of the boxes that flow into it');
  assert((await message()).includes('중심: ‘D’'), `notice names the center box (${await message()})`);
  const routes = Object.values(d.edges);
  assert(routes.every((e) => e.sourceAnchor.side === 'right' && e.targetAnchor.side === 'left'), 'all routes run left → right into the center');
  // 정렬은 위치만: id, 방향, 연결, 글은 그대로
  assert(
    JSON.stringify(Object.values(d.edges).map((e) => [e.id, e.sourceNodeId, e.targetNodeId])) ===
      JSON.stringify(Object.values(before13.edges).map((e) => [e.id, e.sourceNodeId, e.targetNodeId])) &&
      Object.values(d.nodes).every((x) => x.text === before13.nodes[x.id].text),
    'sorting changes positions only (ids, directions, connections, text unchanged)',
  );
  void pastBefore;

  // ── 들어오는 흐름이 나가는 흐름과 다른 보드: A→B→C→D, A→E, E→D
  //    → : E는 A 바로 다음 / ← : E는 D 바로 앞 (D로 모여든다). 둘 다 Ctrl+Z 한 번씩.
  await load([['a', 0, 0], ['b', 300, 0], ['c', 600, 0], ['d', 900, 0], ['e', 300, 300]], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'e'], ['e', 'd']], null);
  await win.waitForTimeout(300);
  const orig15 = await doc();
  const past15 = await win.evaluate(() => window.__tf.getState().past.length);
  await press();
  const out15 = await doc();
  assert(cx(out15.nodes.e) === cx(out15.nodes.b), 'outgoing: E right after A (same column as B)');
  await press();
  const in15 = await doc();
  assert(cx(in15.nodes.e) === cx(in15.nodes.c), 'incoming: E right before D (same column as C)');
  assert((await message()).includes('들어오는 흐름(←) 중심으로 정렬했습니다'), 'notice: incoming sort done');
  await win.screenshot({ path: 'e2e/out/phase23-incoming.png' });
  assert((await win.evaluate(() => window.__tf.getState().past.length)) === past15 + 2, 'each sort is one undo step');
  await win.keyboard.press('Control+z');
  assert(positions(await doc()) === positions(out15), 'Ctrl+Z undoes the incoming sort (back to the outgoing layout)');
  await win.keyboard.press('Control+z');
  assert(positions(await doc()) === positions(orig15), 'Ctrl+Z again: back to the positions before any sorting');
  await win.keyboard.press('Control+y');
  await win.keyboard.press('Control+y');
  assert(positions(await doc()) === positions(in15), 'Ctrl+Y redoes both');

  // ── Scenario 14: 순환 A → B → C → A, 들어오는 흐름 정렬 — 멈추지 않는다
  await load([['a', 0, 0], ['b', 400, 0], ['c', 200, 300]], [['a', 'b'], ['b', 'c'], ['c', 'a']], null);
  await win.waitForTimeout(300);
  await press();
  const t0 = Date.now();
  await press();
  assert(Date.now() - t0 < 5000, 'incoming sort on a cycle finishes right away');
  d = await doc();
  const rects = Object.values(d.nodes);
  const overlap = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
  assert(rects.every((p, i) => rects.every((q, j) => i === j || !overlap(p, q))), 'cycle: boxes do not overlap');
  assert(Object.keys(d.edges).length === 3, 'cycle: every route kept');
  assert(await win.evaluate(() => typeof window.__tf.getState().doc === 'object'), 'app still responsive');
  console.log('PHASE 23 OK');
} finally {
  await shutdown(app);
}
