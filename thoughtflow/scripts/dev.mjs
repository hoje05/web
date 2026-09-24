// 개발 실행: Vite dev server + Electron main 컴파일 + Electron 실행
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);

const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'electron/tsconfig.json'], {
  stdio: 'inherit',
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] renderer: ${url}`);

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
