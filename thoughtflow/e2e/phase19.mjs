// 정렬 버튼: 흩어 놓은 Box와 Route를 흐름 순서대로 정렬한다.
// 부드럽게 움직이고, 겹치지 않고, Route가 다른 Box를 지나지 않으며, Ctrl+Z 한 번이면 원래대로, 다시 눌러도 그대로.
import { readFileSync } from 'node:fs';
import { assert, launch, shutdown } from './harness.mjs';

const { app, win } = await launch([]);
const doc = () => win.evaluate(() => window.__tf.getState().doc);
const past = () => win.evaluate(() => window.__tf.getState().past.length);
const message = () => win.evaluate(() => window.__tf.getState().aiActivity?.message ?? '');
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });
const positions = (d) => Object.fromEntries(Object.values(d.nodes).map((n) => [n.id, [n.x, n.y]]));
const arranged = async () => {
  await win.waitForFunction(() => window.__tf.getState().aiActivity?.message.includes('정렬했습니다'));
  await win.waitForTimeout(100);
};

/** 화면에 그려진 Route가 양 끝이 아닌 Box 안을 지나가는 곳 */
const routeCrossings = () =>
  win.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid=box]')].map((b) => ({ id: b.dataset.nodeId, r: b.getBoundingClientRect() }));
    const edges = window.__tf.getState().doc.edges;
    const out = new Set();
    for (const g of document.querySelectorAll('[data-testid=route]')) {
      const e = edges[g.dataset.edgeId];
      const path = g.querySelector('.route-line');
      const ctm = path.getScreenCTM();
      const len = path.getTotalLength();
      for (let t = 0; t <= len; t += 4) {
        const p = path.getPointAtLength(t).matrixTransform(ctm);
        for (const b of boxes) {
          if (b.id === e.sourceNodeId || b.id === e.targetNodeId) continue;
          if (p.x > b.r.left + 3 && p.x < b.r.right - 3 && p.y > b.r.top + 3 && p.y < b.r.bottom - 3) out.add(`${e.id}/${b.id}`);
        }
      }
    }
    return [...out];
  });

try {
  // 사람이 이리저리 그려 둔 보드: 갈래, 다시 만남, 건너뛰는 Route, 순환, 이어지지 않은 Box
  await win.evaluate(() => {
    const s = window.__tf.getState();
    const box = (id, x, y, text) => ({ id, x, y, width: 180, height: 56, text, note: '' });
    const route = (id, a, b) => ({
      id,
      sourceNodeId: a,
      targetNodeId: b,
      sourceAnchor: { side: 'bottom' },
      targetAnchor: { side: 'top' },
      pathPoints: [[0.5, 0.3]],
      pathMode: 'smoothed',
    });
    const nodes = [
      box('a', 120, 420, '여행 가고 싶다'),
      box('b', 640, 80, '비행기 표 알아보기'),
      box('c', 260, 160, '표가 너무 비쌈'),
      box('d', 700, 520, '기차 + 배'),
      box('e', 420, 600, '날짜 바꾸기'),
      box('f', 980, 300, '평일 출발로 예약'),
      box('g', 60, 80, '여권 확인'),
      box('h', 900, 640, '숙소는 나중에'),
    ];
    const edges = [route('r1', 'a', 'b'), route('r2', 'b', 'c'), route('r3', 'c', 'd'), route('r4', 'c', 'e'), route('r5', 'e', 'f'), route('r6', 'd', 'f'), route('r7', 'f', 'a'), route('r8', 'a', 'f')];
    s.commit({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), edges: Object.fromEntries(edges.map((e) => [e.id, e])) });
    s.fitView();
  });
  await win.waitForTimeout(400); // Box 크기 측정
  const orig = await doc();
  const pastBefore = await past();
  await win.screenshot({ path: 'e2e/out/phase19-before.png' });
  assert(await win.isEnabled('[data-testid=tool-arrange]'), 'arrange button is in the toolbar');

  // ── 정렬: 부드럽게 움직인다
  await win.evaluate(() => {
    window.__samples = [];
    const t0 = performance.now();
    const tick = () => {
      const n = window.__tf.getState().doc.nodes.c;
      window.__samples.push([n.x, n.y]);
      if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await win.click('[data-testid=tool-arrange]');
  await arranged();
  await win.waitForTimeout(900);
  const after = await doc();
  const [sx, sy] = [orig.nodes.c.x, orig.nodes.c.y];
  const [ex, ey] = [after.nodes.c.x, after.nodes.c.y];
  const between = (await win.evaluate(() => window.__samples)).filter(([x, y]) => (x - sx) * (x - ex) < 0 || (y - sy) * (y - ey) < 0);
  assert(between.length >= 3, `boxes glide to their new places (${between.length} in-between frames)`);
  assert((await past()) === pastBefore + 1, 'arranging is one undo step');

  // ── 결과: 흐름 순서대로 왼쪽 → 오른쪽, 겹치지 않음, Route가 다른 Box를 지나지 않음
  const n = after.nodes;
  assert(n.a.x < n.b.x && n.b.x < n.c.x && n.c.x < n.d.x && n.d.x === n.e.x && n.e.x < n.f.x, 'flow reads left → right (a → b → c → d/e → f)');
  const rects = await win.$$eval('[data-testid=box]', (els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const overlap = (p, q) => p.left < q.right + 4 && q.left < p.right + 4 && p.top < q.bottom + 4 && q.top < p.bottom + 4;
  assert(rects.every((p, i) => rects.every((q, j) => i === j || !overlap(p, q))), 'no boxes overlap');
  const crossing = await routeCrossings();
  assert(crossing.length === 0, `routes do not cross other boxes (${crossing.join(', ')})`);
  assert(after.edges.r1.sourceAnchor.side === 'right' && after.edges.r1.targetAnchor.side === 'left', 'routes leave from the right and enter from the left');
  assert(after.edges.r7.sourceAnchor.side === 'left' && after.edges.r8.pathMode === 'smoothed', 'the loop back and the long skip route go around the boxes');
  assert(Math.min(n.g.y, n.h.y) > Math.max(...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => n[id].y + n[id].height)), 'boxes without routes line up at the bottom');
  assert(n.g.y === n.h.y && n.g.x < n.h.x, '…in their original order');
  const box = await win.locator('[data-testid=board]').boundingBox();
  const toolbar = await win.locator('.toolbar').boundingBox();
  assert(
    rects.every((r) => r.left >= toolbar.x + toolbar.width && r.right <= box.x + box.width && r.top >= box.y && r.bottom <= box.y + box.height),
    'the view shows the whole arranged board, clear of the toolbar',
  );
  assert((await message()).includes('Box 8개와 Route 8개를 흐름 순서대로 정렬했습니다'), 'a notice says what happened');
  await win.screenshot({ path: 'e2e/out/phase19-after.png' });

  // ── 되돌리기: Ctrl+Z 한 번 → 원래 그대로 (Route 모양까지), Ctrl+Y → 다시 정렬
  await win.mouse.click(30, 760);
  await win.keyboard.press('Control+z');
  let d = await doc();
  assert(JSON.stringify(positions(d)) === JSON.stringify(positions(orig)) && JSON.stringify(d.edges) === JSON.stringify(orig.edges), 'one Ctrl+Z restores the original layout and routes');
  await win.keyboard.press('Control+y');
  assert(JSON.stringify(positions(await doc())) === JSON.stringify(positions(after)), 'Ctrl+Y arranges again');

  // ── 다시 눌러도 그대로
  const pastNow = await past();
  await win.click('[data-testid=tool-arrange]');
  await win.waitForFunction(() => window.__tf.getState().aiActivity?.message.includes('이미'));
  assert(JSON.stringify(positions(await doc())) === JSON.stringify(positions(after)) && (await past()) === pastNow, 'pressing it again changes nothing');

  // ── 알림의 되돌리기 버튼, 메뉴의 "정렬"
  await win.keyboard.press('Control+z');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu-command', 'arrange'));
  await arranged();
  await win.waitForTimeout(600);
  assert(JSON.stringify(positions(await doc())) === JSON.stringify(positions(after)), 'menu "정렬" arranges too');
  await win.click('[data-testid=ai-toast-undo]');
  assert(JSON.stringify(positions(await doc())) === JSON.stringify(positions(orig)), "the notice's 되돌리기 restores the original");
  await win.click('[data-testid=tool-arrange]');
  await arranged();
  await win.waitForTimeout(600);

  // ── 자동 저장
  await waitSaved();
  const file = await win.evaluate(() => window.__tf.getState().filePath);
  const saved = JSON.parse(readFileSync(file, 'utf-8'));
  assert(saved.nodes.every((sn) => sn.x === after.nodes[sn.id].x && sn.y === after.nodes[sn.id].y), 'the arranged layout is saved');

  // ── Box가 하나뿐이면 정렬할 것이 없다
  await win.keyboard.press('Control+n');
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 0);
  assert(!(await win.isEnabled('[data-testid=tool-arrange]')), 'the button is off on an empty board');
  console.log('PHASE 19 OK');
} finally {
  await shutdown(app);
}
