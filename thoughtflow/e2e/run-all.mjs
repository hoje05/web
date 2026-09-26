// 모든 e2e 시나리오를 순서대로 실행 (먼저 npm run build 필요)
// Windows: npm run e2e   /  Linux(화면 없음): xvfb-run -a npm run e2e
import { spawnSync } from 'node:child_process';

const files = ['phase2.mjs', 'phase3.mjs', 'phase6.mjs', 'phase9.mjs', 'phase11.mjs', 'phase13.mjs', 'phase14.mjs', 'phase15.mjs'];
let failed = 0;
for (const f of files) {
  console.log(`\n▶ ${f}`);
  const r = spawnSync(process.execPath, [`e2e/${f}`], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf-8' });
  if (r.status !== 0) {
    failed++;
    console.error(r.stderr.split('\n').filter((l) => !/dbus|gpu|libva|viz/i.test(l)).join('\n'));
  }
}
console.log(failed ? `\n✗ ${failed} scenario file(s) failed` : '\n✓ all e2e scenarios passed');
process.exit(failed ? 1 : 0);
