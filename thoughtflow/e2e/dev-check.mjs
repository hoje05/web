// 개발 모드(Vite dev server + React StrictMode)에서 앱이 뜨고 편집이 되는지 확인
// 사용: npx vite --port 5173 & 실행 후  node e2e/dev-check.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '.'], env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173/', THOUGHTFLOW_USER_DATA: '/tmp/tflow-dev-check/user', THOUGHTFLOW_BOARDS_DIR: '/tmp/tflow-dev-check/boards' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.waitForSelector('[data-testid=board]');
await win.mouse.dblclick(500, 300);
await win.keyboard.type('개발 모드 테스트');
await win.keyboard.press('Escape');
// 왼쪽 창 + 검색도 개발 모드(StrictMode)에서 확인
await win.mouse.click(500, 300);
await win.click('[data-testid=panel-note]');
await win.keyboard.type('메모');
await win.keyboard.press('Control+f');
await win.keyboard.type('메모');
const results = await win.locator('[data-testid=search-result]').count();
const text = await win.evaluate(() => Object.values(window.__tf.getState().doc.nodes)[0]?.text);
console.log(JSON.stringify({ url: win.url(), text, results, errors }));
await app.close();
