// 실제 Electron 앱(빌드 결과)을 띄워 조작하는 테스트 도구
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function launch() {
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '.'] });
  const win = await app.firstWindow();
  await win.setViewportSize?.({ width: 1280, height: 800 }).catch(() => {});
  await win.waitForSelector('[data-testid=board]');
  return { app, win };
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

/** world 좌표 → 화면 좌표 */
export async function toScreen(win, p) {
  const { viewport } = await state(win);
  return { x: p.x * viewport.zoom + viewport.panX, y: p.y * viewport.zoom + viewport.panY };
}

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  ✓ ' + msg);
}
