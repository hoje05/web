// 시작 속도 재기 (검사용 도구, run-all에는 없음): 프로젝트 여러 개 + 큰 보드(메모·그래프, 오른쪽 창 열림)를 마지막 파일로 두고
// 실행 → 창이 보일 때 → 보드가 그려질 때까지의 시간을 여러 번 잰다. 첫 번째는 "처음 실행"(캐시 없음)이다.
//   node e2e/perf-startup.mjs [횟수=5] [Box 수=300]
//   THOUGHTFLOW_EXE=release/win-unpacked/ThoughtFlow.exe node e2e/perf-startup.mjs   ← 설치 파일과 같은 앱으로
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox } from './harness.mjs';

const require = createRequire(import.meta.url);
const runs = Number(process.argv[2] ?? 5);
const boxes = Number(process.argv[3] ?? 300);

const sandbox = makeSandbox();
mkdirSync(sandbox.boards, { recursive: true });
mkdirSync(sandbox.userData, { recursive: true });

const note = (i) =>
  [
    `## 생각 ${i}`,
    '이 생각에 대해 길게 적은 메모입니다. **굵게**, *기울임*, `코드`도 섞여 있습니다.',
    '- 첫째 항목',
    '- [ ] 할 일',
    '- [x] 한 일',
    i % 10 === 0 ? '```chart\ntype: bar\ntitle: 결과\n항목, 값\nA, 12\nB, 19\nC, 7\n```' : '> 인용한 문장',
  ].join('\n');

const board = (n) => {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    x: (i % 20) * 240,
    y: Math.floor(i / 20) * 140,
    width: 180,
    height: 56,
    text: `Box ${i} — 생각의 제목`,
    note: note(i),
    tagIds: i % 3 ? ['t1'] : [],
    attachments: [],
  }));
  const edges = nodes.slice(1).map((nd, i) => ({
    id: `e${i}`,
    sourceNodeId: `n${i}`,
    targetNodeId: nd.id,
    sourceAnchor: { side: 'right' },
    targetAnchor: { side: 'left' },
    pathPoints: [],
    pathMode: 'auto',
  }));
  return JSON.stringify(
    {
      format: 'thoughtflow',
      version: 3,
      savedAt: new Date().toISOString(),
      board: { zoom: 1, panX: 200, panY: 200 },
      tags: [{ id: 't1', name: 'AI', normalizedName: 'ai', active: true }],
      nodes,
      edges,
      ui: { tabs: ['n0', 'n10'], activeTab: 'n10', panelOpen: true },
    },
    null,
    2,
  );
};

for (let p = 0; p < 15; p++) writeFileSync(join(sandbox.boards, `프로젝트 ${p}.tflow`), board(p === 0 ? boxes : 40));
const last = join(sandbox.boards, '프로젝트 0.tflow');
writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ lastFile: last, boardsMigrated: true }));

const results = [];
for (let r = 0; r < runs; r++) {
  const t0 = Date.now();
  const exe = process.env.THOUGHTFLOW_EXE;
  const app = await electron.launch({
    executablePath: exe ?? require('electron'),
    args: exe ? [] : ['--no-sandbox', '.'],
    env: { ...process.env, THOUGHTFLOW_USER_DATA: sandbox.userData, THOUGHTFLOW_BOARDS_DIR: sandbox.boards },
  });
  const win = await app.firstWindow();
  const tWindow = Date.now() - t0;
  await app.evaluate(({ BrowserWindow }) => new Promise((res) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isVisible()) res();
    else w.once('show', res);
  }));
  const tShown = Date.now() - t0;
  await win.waitForFunction((n) => {
    const s = window.__tf?.getState();
    return s && s.filePath && Object.keys(s.doc.nodes).length === n && document.querySelectorAll('[data-testid=box]').length > 0;
  }, boxes, { timeout: 60000, polling: 16 });
  const tBoard = Date.now() - t0;
  const nav = await win.evaluate(() => {
    const e = performance.getEntriesByType('navigation')[0];
    const marks = Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('tf:')).map((m) => [m.name.slice(3), Math.round(m.startTime)]));
    return { dcl: Math.round(e.domContentLoadedEventEnd), now: Math.round(performance.now()), marks };
  });
  // 주 프로세스의 단계별 시각 (있으면)
  const main = await app.evaluate(() => globalThis.__tfStartup ?? null);
  results.push({ tWindow, tShown, tBoard, dcl: nav.dcl });
  console.log(
    `run ${r + 1}${r === 0 ? ' (처음)' : ''}: window ${tWindow}ms · shown ${tShown}ms · board drawn ${tBoard}ms` +
      ` | renderer: DOMContentLoaded ${nav.dcl}ms, board ${nav.now}ms ${JSON.stringify(nav.marks)}` +
      (main ? ` | main: ${JSON.stringify(main)}` : ''),
  );
  await app.close();
}
const warm = results.slice(1);
const med = (k) => warm.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(warm.length / 2)];
console.log(`처음 실행: shown ${results[0].tShown}ms · board ${results[0].tBoard}ms`);
console.log(`다시 실행(중앙값): shown ${med('tShown')}ms · board ${med('tBoard')}ms · renderer DOMContentLoaded ${med('dcl')}ms`);
