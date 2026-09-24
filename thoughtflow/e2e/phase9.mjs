import { launch, state, drag, assert, toScreen } from './harness.mjs';

const { app, win } = await launch();
const box = async (x, y, text) => {
  await win.mouse.dblclick(x, y);
  await win.keyboard.type(text);
  await win.keyboard.press('Escape');
  const s = await state(win);
  return Object.values(s.doc.nodes).find((n) => n.text === text);
};
const center = (n) => toScreen(win, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
const border = (n, side) =>
  toScreen(win, {
    top: { x: n.x + n.width / 2, y: n.y + 2 },
    bottom: { x: n.x + n.width / 2, y: n.y + n.height - 2 },
    left: { x: n.x + 2, y: n.y + n.height / 2 },
    right: { x: n.x + n.width - 2, y: n.y + n.height / 2 },
  }[side]);
const connect = async (from, side, to) => drag(win, await border(from, side), await center(to), { steps: 20 });
const routeStyle = (id) =>
  win.evaluate((id) => {
    const g = document.querySelector(`[data-edge-id="${id}"]`);
    const line = g.querySelector('.route-line');
    return {
      stroke: getComputedStyle(line).stroke,
      opacity: getComputedStyle(g).opacity,
      glow: !!g.querySelector('.route-glow'),
      start: (() => {
        const p = line.getPointAtLength(0);
        return { x: Math.round(p.x), y: Math.round(p.y) };
      })(),
    };
  }, id);

try {
  // 요구사항 예시:  A → B → C / B → D / E → B
  const A = await box(250, 380, 'A 처음 생각');
  const B = await box(560, 380, 'B 행동');
  const C = await box(900, 200, 'C 결과1');
  const D = await box(900, 560, 'D 결과2');
  const F = await box(900, 380, 'F 결과3');
  const E = await box(560, 650, 'E 다른 계기');
  const X = await box(250, 650, 'X 무관');
  const Y = await box(250, 180, 'Y 무관');
  await connect(A, 'right', B);
  await connect(B, 'right', C);
  await connect(B, 'right', D);
  await connect(B, 'right', F);
  await connect(E, 'top', B);
  await connect(Y, 'bottom', X);
  let s = await state(win);
  const edges = Object.values(s.doc.edges);
  assert(edges.length === 6, '6 routes created');
  const find = (a, b) => edges.find((e) => e.sourceNodeId === a.id && e.targetNodeId === b.id);
  const [eAB, eBC, eBD, eBF, eEB, eYX] = [find(A, B), find(B, C), find(B, D), find(B, F), find(E, B), find(Y, X)];

  // Anchor Distribution: B의 right 면에 3개 → 1/4, 2/4, 3/4 (위쪽 C, 가운데 F, 아래쪽 D)
  const Bn = s.doc.nodes[B.id];
  const startC = (await routeStyle(eBC.id)).start;
  const startF = (await routeStyle(eBF.id)).start;
  const startD = (await routeStyle(eBD.id)).start;
  const x = Math.round(Bn.x + Bn.width);
  assert(startC.x === x && startF.x === x && startD.x === x, 'all three leave from B.right');
  const t = (p) => (p.y - Bn.y) / Bn.height;
  assert(Math.abs(t(startC) - 0.25) < 0.02 && Math.abs(t(startF) - 0.5) < 0.02 && Math.abs(t(startD) - 0.75) < 0.02,
    `B.right anchors at 1/4, 2/4, 3/4 ordered by target (${[startC, startF, startD].map((p) => t(p).toFixed(2))})`);

  // Highlight: B 선택
  await win.mouse.click((await center(Bn)).x, (await center(Bn)).y);
  const green = 'rgb(22, 163, 74)';
  const purple = 'rgb(124, 58, 237)';
  for (const [e, color, name] of [[eBC, green, 'B→C'], [eBD, green, 'B→D'], [eBF, green, 'B→F'], [eAB, purple, 'A→B'], [eEB, purple, 'E→B']]) {
    const st = await routeStyle(e.id);
    assert(st.stroke === color && st.glow, `${name} is ${color === green ? 'green (outgoing)' : 'purple (incoming)'} with glow`);
  }
  const un = await routeStyle(eYX.id);
  assert(!un.glow && parseFloat(un.opacity) > 0.3 && parseFloat(un.opacity) < 1, `unrelated route stays visible but dimmed (opacity ${un.opacity})`);
  await win.screenshot({ path: 'e2e/out/phase10-highlight.png' });

  // 선택 해제 → 모두 기본색
  await win.mouse.click(700, 760);
  const normal = await routeStyle(eBC.id);
  assert(!normal.glow && normal.opacity === '1' && normal.stroke === 'rgb(142, 148, 156)', 'deselect restores neutral color');

  // C 선택 → B→C가 보라(incoming)
  const Cn = (await state(win)).doc.nodes[C.id];
  await win.mouse.click((await center(Cn)).x, (await center(Cn)).y);
  assert((await routeStyle(eBC.id)).stroke === purple, 'same route is incoming (purple) from C’s point of view');
  console.log('PHASE 9-10 OK');
} finally {
  await app.close();
}
