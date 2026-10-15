// 오른쪽 창의 탭 줄: 어디서든 왼쪽 버튼으로 잡고 좌우로 끌어 넘겨 보기.
// 탭 위에서 끌어도 그 탭은 열리지 않고, 살짝 눌렀다 떼면 원래대로 탭이 열린다. 휠도 그대로.
import { assert, launch, shutdown } from './harness.mjs';

const { app, win } = await launch([], { autoPanel: true });
const st = () => win.evaluate(() => {
  const s = window.__tf.getState();
  return { activeTab: s.activeTab, selection: s.selection, tabs: s.tabs };
});
const scrollLeft = () => win.$eval('.panel-tabs', (el) => el.scrollLeft);

try {
  // 탭이 창 폭을 넘도록 Box 14개를 열어 둔다
  await win.evaluate(() => {
    const s = window.__tf.getState();
    const nodes = {};
    for (let i = 0; i < 14; i++) {
      const id = `n${i}`;
      nodes[id] = { id, x: (i % 5) * 220, y: Math.floor(i / 5) * 120, width: 180, height: 56, text: `생각 ${i + 1}번`, note: '' };
    }
    s.commit({ ...s.doc, nodes });
    for (let i = 0; i < 14; i++) s.openPage(`n${i}`, { force: true });
    s.activateTab('n0');
  });
  await win.waitForTimeout(300);
  await win.$eval('.panel-tabs', (el) => (el.scrollLeft = 0));
  const bar = await win.locator('.panel-tabs').boundingBox();
  const max = await win.$eval('.panel-tabs', (el) => el.scrollWidth - el.clientWidth);
  assert(max > 200, `tabs overflow the bar (${max}px hidden)`);

  // ── Scenario 1: 탭 줄의 빈 곳(탭 아래 여백)을 잡고 왼쪽으로 끌면 숨어 있던 오른쪽 탭이 보인다
  const y = bar.y + 4; // 탭 위쪽 여백 (탭이 아닌 곳)
  const hit = await win.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [bar.x + bar.width / 2, y]);
  assert(hit === 'panel-tabs', `grabbing an empty spot of the bar (${hit})`);
  await win.mouse.move(bar.x + bar.width - 40, y);
  await win.mouse.down();
  for (let i = 1; i <= 10; i++) await win.mouse.move(bar.x + bar.width - 40 - i * 20, y);
  assert((await scrollLeft()) === 200, `the tab list follows the mouse exactly (200px → ${await scrollLeft()})`);
  // 탭 줄 밖으로 나가도 계속 따라온다
  await win.mouse.move(bar.x + bar.width - 40 - 260, y + 120);
  assert((await scrollLeft()) === 260, 'keeps following outside the bar');
  await win.mouse.up();
  const lastVisible = await win.evaluate(() => {
    const bar = document.querySelector('.panel-tabs').getBoundingClientRect();
    const tabs = [...document.querySelectorAll('[data-testid=panel-tab]')];
    return tabs.filter((t) => t.getBoundingClientRect().right <= bar.right + 1).length;
  });
  assert(lastVisible > 3, `hidden tabs on the right come into view (${lastVisible} visible from the left)`);
  assert((await st()).activeTab === 'n0', 'dragging an empty spot opens nothing');

  // 다시 오른쪽으로 끌면 앞쪽 탭이 돌아온다
  await win.mouse.move(bar.x + 60, y);
  await win.mouse.down();
  for (let i = 1; i <= 15; i++) await win.mouse.move(bar.x + 60 + i * 20, y);
  await win.mouse.up();
  assert((await scrollLeft()) === 0, 'dragging right brings the first tabs back');

  // ── Scenario 2: 탭 위에서 끌면 목록만 움직이고 그 탭은 열리지 않는다
  const tab = await win.locator('[data-testid=panel-tab]').nth(3).boundingBox();
  const ty = tab.y + tab.height / 2;
  await win.mouse.move(tab.x + tab.width / 2, ty);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) await win.mouse.move(tab.x + tab.width / 2 - i * 15, ty);
  await win.mouse.up();
  let s = await st();
  assert((await scrollLeft()) === 120, `dragging on a tab scrolls the list (${await scrollLeft()})`);
  assert(s.activeTab === 'n0' && s.selection?.id === 'n0', 'the tab under the drag is not opened');
  // × 위에서 끌어도 탭은 닫히지 않는다
  const close = await win.locator('[data-testid=panel-tab].is-active .panel-tab-close').boundingBox();
  await win.$eval('.panel-tabs', (el) => (el.scrollLeft = 0));
  const cb = await win.locator('[data-testid=panel-tab].is-active .panel-tab-close').boundingBox();
  await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await win.mouse.down();
  for (let i = 1; i <= 6; i++) await win.mouse.move(cb.x + cb.width / 2 - i * 10, cb.y + cb.height / 2);
  await win.mouse.up();
  assert(close && (await st()).tabs.length === 14, 'dragging from a tab × does not close the tab');

  // ── Scenario 3: 거의 움직이지 않고 눌렀다 떼면 그 탭이 열린다 (조금 흔들려도)
  await win.$eval('.panel-tabs', (el) => (el.scrollLeft = 0));
  const t5 = await win.locator('[data-testid=panel-tab]').nth(1).boundingBox();
  await win.mouse.move(t5.x + t5.width / 2, t5.y + t5.height / 2);
  await win.mouse.down();
  await win.mouse.move(t5.x + t5.width / 2 + 3, t5.y + t5.height / 2 + 1);
  await win.mouse.up();
  s = await st();
  assert(s.activeTab === 'n1' && s.selection?.id === 'n1', `a short click opens the tab and selects its box (${JSON.stringify(s)})`);
  assert((await scrollLeft()) === 0, 'a click does not scroll the list');
  await win.click('[data-testid=panel-tab]:has-text("생각 3번")');
  assert((await st()).activeTab === 'n2', 'ordinary clicks still switch tabs');
  await win.click('[data-testid=panel-tab]:has-text("생각 3번") .panel-tab-close');
  assert((await st()).tabs.length === 13 && !(await st()).tabs.includes('n2'), 'ordinary × still closes the tab');

  // ── 활성 탭은 눈에 띄게 (굵은 글씨 + 위쪽 줄)
  const look = await win.$eval('[data-testid=panel-tab].is-active', (el) => {
    const c = getComputedStyle(el);
    return { weight: c.fontWeight, shadow: c.boxShadow };
  });
  assert(Number(look.weight) >= 600 && look.shadow !== 'none', `active tab stands out (${look.weight}, ${look.shadow})`);

  // ── 휠도 그대로: 세로 휠 → 가로 스크롤, 가로 휠(트랙패드)
  await win.$eval('.panel-tabs', (el) => (el.scrollLeft = 0));
  await win.mouse.move(bar.x + 100, bar.y + bar.height / 2);
  await win.mouse.wheel(0, 150);
  await win.waitForTimeout(200);
  const afterWheel = await scrollLeft();
  assert(afterWheel > 0, `vertical wheel scrolls the tabs (${afterWheel})`);
  await win.mouse.wheel(120, 0);
  await win.waitForTimeout(200);
  assert((await scrollLeft()) > afterWheel, 'horizontal wheel / trackpad scrolls the tabs');
  assert((await win.evaluate(() => window.__tf.getState().past.length)) === 1, 'tab scrolling is not an undo step');
  console.log('PHASE 20 OK');
} finally {
  await shutdown(app);
}
