// 실제 Electron 앱(빌드 결과)을 띄워 조작하는 테스트 도구
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** 사용자 데이터/자동 저장 폴더를 테스트 전용 임시 폴더로 분리 */
export function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'tflow-e2e-'));
  return { dir, userData: join(dir, 'user'), boards: join(dir, 'boards') };
}

/**
 * autoPanel=false(기본): 클릭해도 오른쪽 창이 열리지 않는 상태로 시작 (Board 동작만 검사하는 시나리오용)
 */
export async function launch(extraArgs = [], { sandbox = makeSandbox(), autoPanel = false } = {}) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', '.', ...extraArgs],
    env: { ...process.env, THOUGHTFLOW_USER_DATA: sandbox.userData, THOUGHTFLOW_BOARDS_DIR: sandbox.boards },
  });
  const win = await app.firstWindow();
  await win.setViewportSize?.({ width: 1280, height: 800 }).catch(() => {});
  await win.waitForSelector('[data-testid=board]');
  // 창 크기 변경이 끝난 뒤에 좌표를 재도록 (도구 막대는 세로 가운데에 붙어 있다)
  await win.waitForFunction(() => innerWidth === 1280 && innerHeight === 800 && window.__tf.getState().boardSize.height === 800);
  if (!autoPanel) await win.evaluate(() => window.__tf.getState().setPanelDismissed(true));
  return { app, win, sandbox };
}

export const state = (win) =>
  win.evaluate(() => {
    const s = window.__tf.getState();
    return {
      doc: s.doc,
      selection: s.selection,
      editingNodeId: s.editingNodeId,
      viewport: s.viewport,
      tool: s.tool,
      past: s.past.length,
      future: s.future.length,
      dirty: s.doc !== s.savedDoc,
      filePath: s.filePath,
      saveState: s.saveState,
      panelOpen: s.panelOpen,
      tabs: s.tabs,
      activeTab: s.activeTab,
    };
  });

export async function drag(win, from, to, { steps = 12, path = null } = {}) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  const pts = path ?? Array.from({ length: steps }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / steps,
    y: from.y + ((to.y - from.y) * (i + 1)) / steps,
  }));
  for (const p of pts) await win.mouse.move(p.x, p.y);
  await win.mouse.up();
}

/** world 좌표 → 창(window) 좌표 (Board 요소의 위치까지 반영) */
export async function toScreen(win, p) {
  const { viewport } = await state(win);
  const o = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=board]').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  return { x: o.x + p.x * viewport.zoom + viewport.panX, y: o.y + p.y * viewport.zoom + viewport.panY };
}

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  ✓ ' + msg);
}

/** 테스트 종료: 앱이 마지막 자동 저장을 마치고 닫히게 한다 */
export async function shutdown(app) {
  await app.close().catch(() => {});
}
