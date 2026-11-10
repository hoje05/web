// 개발 실행: Vite dev server + Electron main 컴파일 + Electron 실행
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);

// main/preload + Claude 확장 빌드 (esbuild)
const built = spawnSync(process.execPath, ['scripts/build-electron.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] renderer: ${url}`);

const electronPath = require('electron');
// npm run dev -- <electron 인자>  (예: Linux root 환경의 --no-sandbox)
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
