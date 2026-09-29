// 사용자 PC에서 생기는 상황: 예전 문서 폴더의 보드 옮기기, 창이 최소화된 채 AI 요청,
// 저장이 멈추거나(OneDrive·백신이 파일을 잡고 있음) 파일 교체가 막힐 때도 앱과 AI가 멈추지 않는지 확인한다.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, launch, makeSandbox, shutdown } from './harness.mjs';

const sandbox = makeSandbox();
const legacy = join(sandbox.dir, 'Documents', 'ThoughtFlow');
mkdirSync(legacy, { recursive: true });
mkdirSync(sandbox.userData, { recursive: true });
const oldBoard = join(legacy, '예전 생각.tflow');
const oldContent = JSON.stringify({
  format: 'thoughtflow',
  version: 2,
  board: { zoom: 1, panX: 400, panY: 300 },
  nodes: [{ id: 'n_old1', x: 0, y: 0, width: 180, height: 56, text: '예전에 적은 생각', note: '' }],
  edges: [],
});
writeFileSync(oldBoard, oldContent);
writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ lastFile: oldBoard, recent: [oldBoard] }));
process.env.THOUGHTFLOW_LEGACY_BOARDS_DIR = legacy;

const { app, win } = await launch([], { sandbox });
const readSettings = () => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf-8'));
const text = (r) => r.content.map((c) => c.text).join('\n');
// 창이 최소화되면 화면 그리기(requestAnimationFrame)가 멈추므로 시간 간격으로 확인한다
const until = (fn, arg, timeout = 10000) => win.waitForFunction(fn, arg, { polling: 100, timeout });
const saved = (timeout) =>
  until(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  }, null, timeout);

const claude = new Client({ name: 'claude-ai', version: '1.0.0' });
await claude.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['dist-mcp/bundle/server/index.js'],
    env: { ...process.env, THOUGHTFLOW_BRIDGE_FILE: join(sandbox.userData, 'bridge.json') },
  }),
);
const timed = async (name, args = {}) => {
  const t = Date.now();
  const r = await claude.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
  return { r, ms: Date.now() - t };
};

try {
  // ── 예전 문서/ThoughtFlow의 보드 → 이 PC의 프로젝트 폴더로 복사
  const moved = join(sandbox.boards, '예전 생각.tflow');
  await until((p) => window.__tf.getState().filePath === p, moved);
  assert(existsSync(moved) && readFileSync(oldBoard, 'utf-8') === oldContent, 'old boards are copied to the local projects folder (original kept)');
  assert(Object.values((await win.evaluate(() => window.__tf.getState().doc)).nodes).some((n) => n.text === '예전에 적은 생각'), 'the last board opens from the new place');
  const st = readSettings();
  assert(st.boardsMigrated === true && st.lastFile === moved && st.recent[0] === moved, 'last board and recent list point to the new place');

  // ── 창을 최소화한 채 (사용자는 Claude 창을 보고 있다)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    // 사용자는 다른 창(Claude)을 보고 있다 (창 관리자가 없는 Linux 테스트 환경에서도 같게)
    globalThis.__isFocused = w.isFocused;
    w.isFocused = () => false;
    globalThis.__flash = [];
    const flash = w.flashFrame.bind(w);
    w.flashFrame = (f) => {
      globalThis.__flash.push(f);
      flash(f);
    };
    w.minimize();
  });
  await win.waitForTimeout(800);
  const vis = await win.evaluate(() => document.visibilityState);
  let t = await timed('get_board');
  assert(!t.r.isError && t.ms < 5000, `get_board answers while the window is minimized (${t.ms}ms, page ${vis})`);
  t = await timed('create_project', { name: '가려진 창에서 정리', boxes: [{ title: '하나' }, { title: '둘' }, { title: '셋' }] });
  assert(!t.r.isError && t.ms < 5000, `create_project with boxes works while minimized (${t.ms}ms)`);
  await saved(5000);
  assert(JSON.parse(readFileSync(join(sandbox.boards, '가려진 창에서 정리.tflow'), 'utf-8')).nodes.length === 3, 'AI changes are saved while minimized');
  assert((await app.evaluate(() => globalThis.__flash)).includes(true), 'taskbar button flashes when the AI changes the board in the background');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.isFocused = globalThis.__isFocused;
    w.restore();
  });

  // ── 저장이 끝나지 않는 상황 (파일 쓰기가 멈춤)
  await app.evaluate(() => {
    const fsp = process.mainModule.require('fs').promises;
    const writeFile = fsp.writeFile;
    globalThis.__stuck = true;
    fsp.writeFile = (p, ...rest) => (globalThis.__stuck && String(p).includes('.tflow') ? new Promise(() => {}) : writeFile.call(fsp, p, ...rest));
  });
  t = await timed('add_flow', { boxes: [{ title: '저장이 막힌 동안' }] });
  assert(!t.r.isError && t.ms < 5000, `AI still works while saving is stuck (${t.ms}ms)`);
  t = await timed('get_board');
  assert(!t.r.isError && text(t.r).includes('저장이 막힌 동안') && t.ms < 5000, 'reading the board still works while saving is stuck');
  t = await timed('create_project', { name: '막힌 동안' });
  assert(t.r.isError && text(t.r).includes('저장하지 못해서') && t.ms < 25000, `new project explains the problem instead of hanging (${t.ms}ms)`);
  assert((await win.evaluate(() => window.__tf.getState().saveState)) === 'error', 'the bar shows that saving failed');
  t = await timed('get_board');
  assert(!t.r.isError && t.ms < 5000, 'later requests are not blocked');
  await app.evaluate(() => (globalThis.__stuck = false));
  await timed('add_flow', { boxes: [{ title: '다시 저장됨' }] });
  await saved(20000);
  const current = await win.evaluate(() => window.__tf.getState().filePath);
  const nodes = JSON.parse(readFileSync(current, 'utf-8')).nodes.map((n) => n.text);
  assert(nodes.includes('저장이 막힌 동안') && nodes.includes('다시 저장됨'), 'once the disk answers again, everything is saved');
  t = await timed('create_project', { name: '막힌 뒤' });
  assert(!t.r.isError && existsSync(join(sandbox.boards, '막힌 뒤.tflow')), 'new project works again');

  // ── 파일 교체가 막힐 때 (백신·동기화 프로그램이 파일을 잠깐 잡고 있음)
  await app.evaluate(() => {
    const fsp = process.mainModule.require('fs').promises;
    const rename = fsp.rename;
    globalThis.__renameFails = 3;
    fsp.rename = async (a, b) => {
      if (String(b).endsWith('.tflow') && globalThis.__renameFails > 0) {
        globalThis.__renameFails--;
        const err = new Error('EPERM: operation not permitted, rename');
        err.code = 'EPERM';
        throw err;
      }
      return rename.call(fsp, a, b);
    };
  });
  await timed('add_flow', { boxes: [{ title: '잠깐 막힘' }] });
  await saved(10000);
  assert(JSON.parse(readFileSync(join(sandbox.boards, '막힌 뒤.tflow'), 'utf-8')).nodes.some((n) => n.text === '잠깐 막힘'), 'save retries when the file is briefly locked');
  await app.evaluate(() => (globalThis.__renameFails = 1e9));
  await timed('add_flow', { boxes: [{ title: '계속 막힘' }] });
  await saved(10000);
  assert(JSON.parse(readFileSync(join(sandbox.boards, '막힌 뒤.tflow'), 'utf-8')).nodes.some((n) => n.text === '계속 막힘'), 'save still succeeds when replacing keeps failing');
  assert(!readdirSync(sandbox.boards).some((f) => f.endsWith('.tmp')), 'no temporary files left behind');
  await app.evaluate(() => (globalThis.__renameFails = 0));

  console.log('PHASE 17 OK');
} finally {
  delete process.env.THOUGHTFLOW_LEGACY_BOARDS_DIR;
  await claude.close().catch(() => {});
  await shutdown(app);
  rmSync(sandbox.dir, { recursive: true, force: true });
}
