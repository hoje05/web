// 요구사항 34의 사용자 흐름을 실제로 조작하며 스크린샷을 남긴다 (검증용 데모)
import { launch, state, drag, toScreen, shutdown } from './harness.mjs';

const { app, win } = await launch();
const nodeBy = async (text) => Object.values((await state(win)).doc.nodes).find((n) => n.text === text);
const edgeOut = (n, side) =>
  toScreen(win, {
    right: { x: n.x + n.width - 2, y: n.y + n.height / 2 },
    bottom: { x: n.x + n.width / 2, y: n.y + n.height - 2 },
    left: { x: n.x + 2, y: n.y + n.height / 2 },
    top: { x: n.x + n.width / 2, y: n.y + 2 },
  }[side]);
/** 손으로 그린 듯한 경로 */
const hand = (a, b, bend = 0, wobble = 3) =>
  Array.from({ length: 36 }, (_, i) => {
    const t = (i + 1) / 36;
    const nx = -(b.y - a.y), ny = b.x - a.x, L = Math.hypot(nx, ny) || 1;
    const k = Math.sin(Math.PI * t) * bend + Math.sin(t * 31) * wobble;
    return { x: a.x + (b.x - a.x) * t + (nx / L) * k, y: a.y + (b.y - a.y) * t + (ny / L) * k };
  });
const extend = async (fromText, side, dx, dy, text, bend = 0, wobble = 2) => {
  const n = await nodeBy(fromText);
  const a = await edgeOut(n, side);
  const b = { x: a.x + dx, y: a.y + dy };
  await drag(win, a, b, { path: hand(a, b, bend, wobble) });
  await win.keyboard.type(text);
  await win.keyboard.press('Escape');
};

try {
  // 1) 첫 Box를 Toolbar에서 끌어다 놓고 생각을 적는다
  const tb = await win.locator('[data-testid=tool-box]').boundingBox();
  await drag(win, { x: tb.x + 26, y: tb.y + 20 }, { x: 250, y: 190 }, { steps: 15 });
  await win.keyboard.type('앱 첫 화면이 너무 복잡하다는 피드백');
  await win.keyboard.press('Escape');

  // 2) 테두리에서 끌어내며 흐름을 이어간다
  await extend('앱 첫 화면이 너무 복잡하다는 피드백', 'right', 150, 0, '메뉴를 절반으로 줄여 봄');
  await extend('메뉴를 절반으로 줄여 봄', 'right', 150, 0, '이탈률 12% → 7%');
  await extend('이탈률 12% → 7%', 'bottom', 0, 110, '남은 메뉴도 사실 안 쓰는 것 아닐까?');
  await extend('남은 메뉴도 사실 안 쓰는 것 아닐까?', 'left', -150, 0, '사용 로그를 2주간 수집');
  await extend('사용 로그를 2주간 수집', 'left', -150, 0, '3개 메뉴만 90% 사용', 0, 2);
  // 크게 우회하는 손그림 Route + 흔들림
  await extend('3개 메뉴만 90% 사용', 'bottom', 420, 150, '홈 화면을 3개 카드로 재설계', -90, 6);

  // 기존 Box끼리 연결 (피드백 → 재설계, 크게 돌아가는 곡선)
  let s = await state(win);
  const fb = await nodeBy('앱 첫 화면이 너무 복잡하다는 피드백');
  const rd = await nodeBy('홈 화면을 3개 카드로 재설계');
  const a = await edgeOut(fb, 'left');
  const bCenter = await toScreen(win, { x: rd.x + 4, y: rd.y + rd.height / 2 });
  const detour = [];
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    detour.push({ x: a.x - Math.sin(Math.PI * t) * 120 + (bCenter.x - a.x) * t * t, y: a.y + (bCenter.y - a.y) * t + Math.sin(i) * 3 });
  }
  await drag(win, a, bCenter, { path: detour });
  await win.mouse.click(1150, 60);
  await win.evaluate(() => window.__tf.getState().fitView());
  await win.waitForTimeout(100);
  await win.screenshot({ path: 'e2e/out/showcase-1-flow.png' });

  // 3) 흔들린 Route 선택 → 보정
  s = await state(win);
  const wobbly = Object.values(s.doc.edges).find((e) => e.pathMode === 'freehand' && s.doc.nodes[e.targetNodeId].text.startsWith('홈') && s.doc.nodes[e.sourceNodeId].text.startsWith('3개'));
  for (const e of Object.values(s.doc.edges)) {
    if (e.pathMode === 'freehand') {
      await win.evaluate((id) => window.__tf.getState().select({ kind: 'edge', id }), e.id);
      await win.click('[data-testid=tool-correct]');
    }
  }
  await win.evaluate((id) => window.__tf.getState().select({ kind: 'edge', id }), wobbly.id);
  await win.screenshot({ path: 'e2e/out/showcase-2-corrected.png' });

  // 4) 중간 Box 선택 → 들어온 흐름(보라) / 나간 흐름(초록)
  const mid = await nodeBy('3개 메뉴만 90% 사용');
  const c = await toScreen(win, { x: mid.x + mid.width / 2, y: mid.y + mid.height / 2 });
  await win.mouse.click(c.x, c.y);
  await win.screenshot({ path: 'e2e/out/showcase-3-selected.png' });

  // 5) 테두리 hover(연결점 표시) + 도움말
  const hv = await edgeOut(await nodeBy('이탈률 12% → 7%'), 'right');
  await win.mouse.click(1150, 60);
  await win.click('button[title="사용법"]');
  await win.mouse.move(hv.x, hv.y);
  await win.waitForTimeout(150);
  await win.screenshot({ path: 'e2e/out/showcase-4-hover-help.png' });
  console.log('showcase done', Object.keys((await state(win)).doc.nodes).length, 'boxes');
} finally {
  await shutdown(app);
}
