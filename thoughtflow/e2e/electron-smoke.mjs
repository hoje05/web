// 실제 Electron 앱을 띄워 기본 동작을 확인하는 스모크 테스트 (npm run build 후 실행)
// 사용: xvfb-run -a node e2e/electron-smoke.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['--no-sandbox', '.'],
});
const win = await app.firstWindow();
await win.waitForSelector('[data-testid=board]');
const title = await win.title();
const before = await win.textContent('[data-testid=zoom-value]');
await win.mouse.move(600, 400);
await win.mouse.wheel(0, -300);
await win.waitForTimeout(100);
const after = await win.textContent('[data-testid=zoom-value]');
await win.screenshot({ path: 'e2e/out/electron-smoke.png' });
console.log(JSON.stringify({ title, before, after }));
await app.close();
if (before === after) {
  console.error('zoom did not change');
  process.exit(1);
}
